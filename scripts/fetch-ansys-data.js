const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const USERNAME = process.env.ANSYS_USERNAME;
const PASSWORD = process.env.ANSYS_PASSWORD;

if (!USERNAME || !PASSWORD) {
    console.error('Error: ANSYS_USERNAME and ANSYS_PASSWORD environment variables must be set');
    process.exit(1);
}

const HEADERS = ['Start Time', 'End Time', 'Product', 'Count', 'Hours', 'Cost', 'Currency', 'Username'];

async function downloadAnsysData() {
    const downloadPath = path.resolve('./data');
    
    if (!fs.existsSync(downloadPath)) {
        fs.mkdirSync(downloadPath, { recursive: true });
    }
    
    console.log('Starting browser...');
    const browser = await puppeteer.launch({
        headless: false,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080'
        ]
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    
    try {
        // LOGIN
        console.log('Navigating to ANSYS licensing portal...');
        await page.goto('https://licensing.ansys.com', { waitUntil: 'networkidle0', timeout: 60000 });
        await new Promise(r => setTimeout(r, 3000));
        
        console.log('Entering email...');
        await page.evaluate((email) => {
            const inputs = document.querySelectorAll('input');
            for (const input of inputs) {
                const rect = input.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0 && input.type !== 'hidden' && input.type !== 'submit') {
                    input.focus();
                    input.value = email;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    break;
                }
            }
        }, USERNAME);
        
        await page.evaluate(() => {
            const btn = document.querySelector('button[type="submit"]');
            if (btn) btn.click();
        });
        
        await new Promise(r => setTimeout(r, 5000));
        
        console.log('Entering password...');
        for (let i = 0; i < 15; i++) {
            const hasPassword = await page.evaluate(() => !!document.querySelector('input[type="password"]'));
            if (hasPassword) break;
            await new Promise(r => setTimeout(r, 2000));
        }
        
        await page.evaluate((pwd) => {
            const pwdInput = document.querySelector('input[type="password"]');
            if (pwdInput) {
                pwdInput.focus();
                pwdInput.value = pwd;
                pwdInput.dispatchEvent(new Event('input', { bubbles: true }));
                pwdInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, PASSWORD);
        
        await page.evaluate(() => {
            const btn = document.querySelector('button[type="submit"]');
            if (btn) btn.click();
        });
        
        await new Promise(r => setTimeout(r, 10000));
        console.log('Login successful!');
        
        // SCRAPE 1 YEAR DATA
        console.log('=== Scraping 1 Year data ===');
        await page.goto('https://licensing.ansys.com/transactions', { waitUntil: 'networkidle0', timeout: 120000 });
        await waitForTableLoad(page);
        await scrapeData(page, '1 Year', 'historical', downloadPath);
        
        // SCRAPE 5 DAYS DATA
        console.log('=== Scraping 5 Days data ===');
        await page.goto('https://licensing.ansys.com/transactions', { waitUntil: 'networkidle0', timeout: 120000 });
        await waitForTableLoad(page);
        await scrapeData(page, '5 Days', 'recent', downloadPath);
        
        console.log('All data scraped successfully!');
        
    } catch (error) {
        console.error('Error:', error.message);
        await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
        throw error;
    } finally {
        await browser.close();
    }
}

async function waitForTableLoad(page) {
    for (let i = 0; i < 30; i++) {
        const hasContent = await page.evaluate(() => {
            return document.body.innerText.includes('Start Time');
        });
        if (hasContent) break;
        await new Promise(r => setTimeout(r, 2000));
    }
    console.log('Page loaded!');
}

async function scrapeData(page, dateOption, filePrefix, downloadPath) {
    // Click date picker
    await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
            if (btn.textContent && btn.textContent.includes('From') && btn.textContent.includes('To')) {
                btn.click();
                return;
            }
        }
    });
    await new Promise(r => setTimeout(r, 2000));
    
    // Select date option
    await page.evaluate((option) => {
        const elements = document.querySelectorAll('*');
        for (const el of elements) {
            if (el.textContent?.trim() === option && el.children.length === 0) {
                el.click();
                return;
            }
        }
    }, dateOption);
    console.log(`Selected ${dateOption}`);
    
    // Wait for table to reload
    await new Promise(r => setTimeout(r, 3000));
    for (let i = 0; i < 10; i++) {
        const loading = await page.evaluate(() => document.body.innerText.includes('Loading'));
        if (!loading) break;
        await new Promise(r => setTimeout(r, 1000));
    }
    await new Promise(r => setTimeout(r, 2000));
    
    // Get page info
    const { totalPages, totalRows } = await page.evaluate(() => {
        const text = document.body.innerText;
        const rowMatch = text.match(/\d+\s+to\s+\d+\s+of\s+([\d,]+)/i);
        const totalRows = rowMatch ? parseInt(rowMatch[1].replace(/,/g, '')) : 0;
        const pageMatch = text.match(/Page\s+\d+\s+of\s+(\d+)/i);
        const totalPages = pageMatch ? parseInt(pageMatch[1]) : 1;
        return { totalPages, totalRows };
    });
    
    console.log(`Total pages: ${totalPages}, Total rows expected: ${totalRows}`);
    
    // Find the next button by looking at pagination area
    // The buttons are: |< < > >| - we want the 3rd one (index 2)
    const paginationInfo = await page.evaluate(() => {
        // Find element containing "Page X of Y"
        const allElements = Array.from(document.querySelectorAll('*'));
        let paginationContainer = null;
        
        for (const el of allElements) {
            const text = el.textContent || '';
            if (text.match(/Page\s+\d+\s+of\s+\d+/) && el.children.length < 10) {
                paginationContainer = el.closest('div');
                break;
            }
        }
        
        if (!paginationContainer) {
            return { found: false, buttons: [] };
        }
        
        // Get all buttons in this container and nearby
        const parentDiv = paginationContainer.parentElement || paginationContainer;
        const buttons = parentDiv.querySelectorAll('button');
        
        const buttonData = Array.from(buttons).map((btn, i) => {
            const rect = btn.getBoundingClientRect();
            return {
                index: i,
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                disabled: btn.disabled,
                html: btn.innerHTML.substring(0, 100)
            };
        });
        
        return { found: true, buttonCount: buttons.length, buttons: buttonData };
    });
    
    console.log(`Pagination: ${paginationInfo.buttonCount} buttons found`);
    
    // Scrape all pages
    let allData = [];
    
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        console.log(`Scraping page ${pageNum}/${totalPages}...`);
        
        await new Promise(r => setTimeout(r, 1500));
        
        // Get table data
        const pageData = await page.evaluate((numCols) => {
            const rows = [];
            const rowElements = document.querySelectorAll('[role="row"]');
            
            rowElements.forEach((row, index) => {
                if (index === 0) return;
                
                let cells = row.querySelectorAll('[role="cell"]');
                if (cells.length === 0) cells = row.querySelectorAll('[role="gridcell"]');
                if (cells.length === 0) cells = row.querySelectorAll('td');
                
                if (cells.length > 0) {
                    const rowData = Array.from(cells)
                        .slice(0, numCols)
                        .map(c => (c.textContent?.trim() || '').replace(/\n/g, ' ').replace(/\s+/g, ' '));
                    rows.push(rowData);
                }
            });
            
            return rows;
        }, HEADERS.length);
        
        console.log(`  Got ${pageData.length} rows`);
        allData = allData.concat(pageData);
        
        // Go to next page
        if (pageNum < totalPages) {
            // Click the "next" button - it's the 3rd button in pagination (index 2)
            // Buttons are: |< (first), < (prev), > (next), >| (last)
            const clicked = await page.evaluate(() => {
                // Find the pagination container
                const allElements = Array.from(document.querySelectorAll('*'));
                let paginationContainer = null;
                
                for (const el of allElements) {
                    const text = el.textContent || '';
                    if (text.match(/Page\s+\d+\s+of\s+\d+/) && el.children.length < 10) {
                        paginationContainer = el.closest('div')?.parentElement;
                        break;
                    }
                }
                
                if (!paginationContainer) {
                    return 'no pagination container';
                }
                
                // Get all buttons
                const buttons = Array.from(paginationContainer.querySelectorAll('button'));
                
                // Filter to only small icon-like buttons (pagination buttons are usually small)
                const paginationButtons = buttons.filter(btn => {
                    const rect = btn.getBoundingClientRect();
                    return rect.width < 60 && rect.width > 20;
                });
                
                // Sort by x position (left to right)
                paginationButtons.sort((a, b) => {
                    return a.getBoundingClientRect().x - b.getBoundingClientRect().x;
                });
                
                // The "next" button should be the 3rd one (index 2) in: |< < > >|
                // Or the 2nd one (index 1) if there are only 2 visible: < >
                if (paginationButtons.length >= 4) {
                    const nextBtn = paginationButtons[2]; // 3rd button
                    if (!nextBtn.disabled) {
                        nextBtn.click();
                        return `clicked button index 2 of ${paginationButtons.length}`;
                    }
                    return 'button 2 is disabled';
                } else if (paginationButtons.length >= 2) {
                    const nextBtn = paginationButtons[1]; // 2nd button
                    if (!nextBtn.disabled) {
                        nextBtn.click();
                        return `clicked button index 1 of ${paginationButtons.length}`;
                    }
                    return 'button 1 is disabled';
                }
                
                return `only ${paginationButtons.length} pagination buttons found`;
            });
            
            console.log(`  Next: ${clicked}`);
            
            // Wait for page to change
            await new Promise(r => setTimeout(r, 2500));
        }
    }
    
    console.log(`Scraped ${allData.length} rows total (expected ${totalRows})`);
    
    // Deduplicate
    const uniqueData = [];
    const seen = new Set();
    for (const row of allData) {
        const key = row.join('|');
        if (!seen.has(key)) {
            seen.add(key);
            uniqueData.push(row);
        }
    }
    console.log(`After dedup: ${uniqueData.length} unique rows`);
    
    // Convert to CSV
    const csvContent = [
        HEADERS.join(','),
        ...uniqueData.map(row => {
            while (row.length < HEADERS.length) row.push('');
            return row.slice(0, HEADERS.length)
                .map(cell => `"${(cell || '').replace(/"/g, '""')}"`)
                .join(',');
        })
    ].join('\n');
    
    const filePath = path.join(downloadPath, `${filePrefix}.csv`);
    fs.writeFileSync(filePath, csvContent);
    console.log(`Saved ${filePrefix}.csv (${uniqueData.length} rows)`);
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
