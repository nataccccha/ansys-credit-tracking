const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const USERNAME = process.env.ANSYS_USERNAME;
const PASSWORD = process.env.ANSYS_PASSWORD;

if (!USERNAME || !PASSWORD) {
    console.error('Error: ANSYS_USERNAME and ANSYS_PASSWORD environment variables must be set');
    process.exit(1);
}

async function downloadAnsysData() {
    const downloadPath = path.resolve('./data');
    
    if (!fs.existsSync(downloadPath)) {
        fs.mkdirSync(downloadPath, { recursive: true });
    }
    
    console.log('Starting browser...');
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    try {
        // LOGIN
        console.log('Navigating to ANSYS licensing portal...');
        await page.goto('https://licensing.ansys.com', { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));
        
        const emailInput = await page.$('input[type="email"]') || 
                          await page.$('input[id="email"]') ||
                          await page.$('input:not([type="hidden"]):not([type="submit"])');
        
        if (emailInput) {
            await emailInput.click();
            await emailInput.type(USERNAME);
            console.log('Email entered');
        }
        
        await page.click('button[type="submit"]');
        await new Promise(r => setTimeout(r, 5000));
        
        console.log('Entering password...');
        await page.waitForSelector('input[type="password"]', { timeout: 15000 });
        await page.type('input[type="password"]', PASSWORD);
        await page.click('button[type="submit"]');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        console.log('Login successful!');
        
        // GO TO TRANSACTIONS
        console.log('Navigating to Usage Transactions...');
        await page.goto('https://licensing.ansys.com/transactions', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 5000));
        
        await page.screenshot({ path: 'debug-1-transactions-page.png', fullPage: true });
        console.log('Screenshot: transactions page saved');
        
        // DOWNLOAD YTD DATA
        console.log('=== Downloading YTD data ===');
        await selectDateRangeAndDownload(page, 'YTD', 'historical', downloadPath);
        
        // DOWNLOAD 5 DAYS DATA  
        console.log('=== Downloading 5 Days data ===');
        await selectDateRangeAndDownload(page, '5 Days', 'recent', downloadPath);
        
        console.log('All downloads complete!');
        
        // Upload screenshots as artifacts
        console.log('Debug screenshots saved');
        
    } catch (error) {
        console.error('Error during automation:', error);
        await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
        throw error;
    } finally {
        await browser.close();
    }
}

async function selectDateRangeAndDownload(page, dateOption, filePrefix, downloadPath) {
    // Click the date range button
    console.log('Opening date picker...');
    
    // Find button containing "From" text
    const clicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
            if (btn.textContent && btn.textContent.includes('From') && btn.textContent.includes('To')) {
                btn.click();
                return true;
            }
        }
        return false;
    });
    
    console.log('Date picker clicked:', clicked);
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: `debug-2-${filePrefix}-datepicker-open.png`, fullPage: true });
    
    // Click on the date option using evaluate
    console.log(`Looking for "${dateOption}" option...`);
    
    const optionClicked = await page.evaluate((option) => {
        // Look for the option in various elements
        const elements = document.querySelectorAll('div, li, span, p, a, button');
        for (const el of elements) {
            const text = el.textContent?.trim();
            if (text === option) {
                el.click();
                return { found: true, text: text };
            }
        }
        // Also try looking for elements that just contain the text
        for (const el of elements) {
            if (el.innerText === option && el.children.length === 0) {
                el.click();
                return { found: true, text: el.innerText };
            }
        }
        return { found: false };
    }, dateOption);
    
    console.log('Option click result:', optionClicked);
    await new Promise(r => setTimeout(r, 4000));
    await page.screenshot({ path: `debug-3-${filePrefix}-after-option.png`, fullPage: true });
    
    // Click download button
    console.log('Looking for download button...');
    
    // Log all buttons with their content
    const buttonInfo = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, [role="button"]');
        const info = [];
        buttons.forEach((btn, i) => {
            info.push({
                index: i,
                text: btn.textContent?.substring(0, 50),
                ariaLabel: btn.getAttribute('aria-label'),
                title: btn.getAttribute('title'),
                hasDownloadText: btn.outerHTML.toLowerCase().includes('download')
            });
        });
        return info;
    });
    
    console.log('Buttons found:', JSON.stringify(buttonInfo.filter(b => b.hasDownloadText || b.ariaLabel || b.title), null, 2));
    
    // Try to click download
    const downloadClicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, [role="button"]');
        for (const btn of buttons) {
            const html = btn.outerHTML.toLowerCase();
            const aria = btn.getAttribute('aria-label')?.toLowerCase() || '';
            const title = btn.getAttribute('title')?.toLowerCase() || '';
            if (html.includes('download') || aria.includes('download') || title.includes('download') ||
                html.includes('export') || aria.includes('export') || title.includes('export')) {
                btn.click();
                return true;
            }
        }
        // Try finding by SVG icon
        const svgs = document.querySelectorAll('svg');
        for (const svg of svgs) {
            const parent = svg.closest('button');
            if (parent && svg.outerHTML.toLowerCase().includes('download')) {
                parent.click();
                return true;
            }
        }
        return false;
    });
    
    console.log('Download button clicked:', downloadClicked);
    await new Promise(r => setTimeout(r, 3000));
    await page.screenshot({ path: `debug-4-${filePrefix}-after-download-click.png`, fullPage: true });
    
    // Wait and check for file
    await new Promise(r => setTimeout(r, 10000));
    
    const files = fs.readdirSync(downloadPath);
    console.log('Files in data folder:', files);
    
    // Try to scrape table if download didn't work
    if (!files.some(f => f.includes('ANSYS') && f.endsWith('.csv'))) {
        console.log('No download detected, scraping table data...');
        
        const tableData = await page.evaluate(() => {
            // Try to find the table
            const table = document.querySelector('table');
            if (!table) {
                // Try MUI/React table
                const rows = document.querySelectorAll('[role="row"]');
                if (rows.length === 0) return null;
                
                const data = [];
                rows.forEach(row => {
                    const cells = row.querySelectorAll('[role="cell"], [role="columnheader"], td, th');
                    const rowData = [];
                    cells.forEach(cell => rowData.push(cell.textContent?.trim() || ''));
                    if (rowData.length > 0 && rowData.some(c => c)) data.push(rowData);
                });
                return data;
            }
            
            const data = [];
            const rows = table.querySelectorAll('tr');
            rows.forEach(row => {
                const cells = row.querySelectorAll('td, th');
                const rowData = [];
                cells.forEach(cell => rowData.push(cell.textContent?.trim() || ''));
                if (rowData.length > 0) data.push(rowData);
            });
            return data;
        });
        
        if (tableData && tableData.length > 0) {
            const csv = tableData.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
            fs.writeFileSync(path.join(downloadPath, `${filePrefix}.csv`), csv);
            console.log(`Created ${filePrefix}.csv from table data (${tableData.length} rows)`);
        } else {
            console.log('Could not scrape table data');
        }
    }
}

downloadAnsysData()
    .then(() => {
        console.log('Done!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Failed:', error);
        process.exit(1);
    });
