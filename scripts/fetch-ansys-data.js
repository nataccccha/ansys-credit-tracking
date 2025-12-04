const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const https = require('https');

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
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Store cookies for later direct download
    let cookies = [];
    
    try {
        // LOGIN
        console.log('Navigating to ANSYS licensing portal...');
        await page.goto('https://licensing.ansys.com', { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));
        
        // Find and fill email
        console.log('Looking for email input...');
        const emailInput = await page.$('input[type="email"]') || 
                          await page.$('input[name="email"]') ||
                          await page.$('input[id="email"]') ||
                          await page.$('input:not([type="hidden"]):not([type="submit"])');
        
        if (emailInput) {
            await emailInput.click();
            await emailInput.type(USERNAME);
            console.log('Email entered');
        } else {
            throw new Error('Could not find email input');
        }
        
        await page.click('button[type="submit"]');
        await new Promise(r => setTimeout(r, 5000));
        
        console.log('Entering password...');
        await page.waitForSelector('input[type="password"]', { timeout: 15000 });
        await page.type('input[type="password"]', PASSWORD);
        await page.click('button[type="submit"]');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        console.log('Login successful!');
        
        // Get cookies after login
        cookies = await page.cookies();
        console.log('Got session cookies');
        
        // GO TO TRANSACTIONS
        console.log('Navigating to Usage Transactions...');
        await page.goto('https://licensing.ansys.com/transactions', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 5000));
        
        // DOWNLOAD YTD DATA
        console.log('=== Downloading YTD data ===');
        await selectDateRangeAndDownload(page, 'YTD', 'historical', downloadPath, cookies);
        
        // DOWNLOAD 5 DAYS DATA  
        console.log('=== Downloading 5 Days data ===');
        await selectDateRangeAndDownload(page, '5 Days', 'recent', downloadPath, cookies);
        
        console.log('All downloads complete!');
        
    } catch (error) {
        console.error('Error during automation:', error);
        await page.screenshot({ path: 'error-screenshot.png' });
        throw error;
    } finally {
        await browser.close();
    }
}

async function selectDateRangeAndDownload(page, dateOption, filePrefix, downloadPath, cookies) {
    // Click the date range button
    console.log('Opening date picker...');
    const buttons = await page.$$('button');
    for (const btn of buttons) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text && text.includes('From') && text.includes('To')) {
            await btn.click();
            console.log('Clicked date picker button');
            break;
        }
    }
    
    await new Promise(r => setTimeout(r, 2000));
    
    // Click on the date option
    console.log(`Looking for "${dateOption}" option...`);
    const allElements = await page.$$('div, li, span, button, p, a');
    for (const el of allElements) {
        const text = await page.evaluate(e => e.textContent?.trim(), el);
        if (text === dateOption) {
            await el.click();
            console.log(`Clicked "${dateOption}"`);
            break;
        }
    }
    
    await new Promise(r => setTimeout(r, 4000));
    
    // Set up request interception to capture download URL
    let downloadUrl = null;
    
    await page.setRequestInterception(true);
    
    page.on('request', request => {
        const url = request.url();
        if (url.includes('download') || url.includes('export') || url.includes('.csv')) {
            console.log('Intercepted download URL:', url);
            downloadUrl = url;
        }
        request.continue();
    });
    
    // Click download button
    console.log('Looking for download button...');
    const allButtons = await page.$$('button, [role="button"]');
    for (const btn of allButtons) {
        const html = await page.evaluate(el => el.outerHTML.toLowerCase(), btn);
        if (html.includes('download') || html.includes('export') || html.includes('filedownload')) {
            console.log('Found download button, clicking...');
            await btn.click();
            break;
        }
    }
    
    await new Promise(r => setTimeout(r, 5000));
    
    // Disable interception
    await page.setRequestInterception(false);
    
    if (downloadUrl) {
        console.log('Downloading from URL:', downloadUrl);
        // Use cookies to download file directly
        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        await downloadFile(downloadUrl, path.join(downloadPath, `${filePrefix}.csv`), cookieString);
        console.log(`Saved ${filePrefix}.csv`);
    } else {
        console.log('No download URL captured, trying alternate method...');
        
        // Try to get data from table and save as CSV
        const tableData = await page.evaluate(() => {
            const rows = document.querySelectorAll('table tr, [role="row"]');
            const data = [];
            rows.forEach(row => {
                const cells = row.querySelectorAll('td, th, [role="cell"], [role="columnheader"]');
                const rowData = [];
                cells.forEach(cell => rowData.push(cell.textContent?.trim() || ''));
                if (rowData.length > 0) data.push(rowData);
            });
            return data;
        });
        
        if (tableData.length > 0) {
            const csv = tableData.map(row => row.join(',')).join('\n');
            fs.writeFileSync(path.join(downloadPath, `${filePrefix}.csv`), csv);
            console.log(`Created ${filePrefix}.csv from table data (${tableData.length} rows)`);
        } else {
            console.log('Warning: Could not get table data');
        }
    }
}

function downloadFile(url, dest, cookieString) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, { headers: { 'Cookie': cookieString } }, response => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', err => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
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
