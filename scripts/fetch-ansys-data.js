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
            return document.body.innerText.includes('Start Time') || document.body.innerText.includes('From');
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
    
    // Scrape all pages
    let allData = [];
    let lastFirstRow = '';
    
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        console.log(`Scraping page ${pageNum}/${totalPages}...`);
        
        await new Promise(r => setTimeout(r, 1500));
        
        // Verify we're on the right page
        const currentPageNum = await page.evaluate(() => {
            const text = document.body.innerText;
            const match = text.match(/Page\s+(\d+)\s+of/i);
            return match ? parseInt(match[1]) : 0;
        });
        console.log(`  Currently on page: ${currentPageNum}`);
        
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
        
        // Check for duplicates
        const firstRow = pageData.length > 0 ? pageData[0].join('|') : '';
        if (firstRow === lastFirstRow && pageNum > 1) {
            console.log(`  WARNING: Duplicate data detected, page didn't change!`);
            // Try clicking next again
            await clickNextPage(page);
            await new Promise(r => setTimeout(r, 3000));
            continue;
        }
        lastFirstRow = firstRow;
        
        console.log(`  Got ${pageData.length} rows`);
        allData = allData.concat(pageData);
        
        // Go to next page
        if (pageNum < totalPages) {
            await clickNextPage(page);
            
            // Wait for page number to change
            for (let i = 0; i < 10; i++) {
                await new Promise(r => setTimeout(r, 500));
                const newPageNum = await page.evaluate(() => {
                    const text = document.body.innerText;
                    const match = text.match(/Page\s+(\d+)\s+of/i);
                    return match ? parseInt(match[1]) : 0;
                });
                if (newPageNum === pageNum + 1) {
                    break;
                }
                if (i === 9) {
                    console.log(`  Page number didn't change, retrying click...`);
                    await clickNextPage(page);
                }
            }
            
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    
    console.log(`Scraped ${allData.length} rows total (expected ${totalRows})`);
    
    // Remove any duplicate rows
    const uniqueData = [];
    const seen = new Set();
    for (const row of allData) {
        const key = row.join('|');
        if (!seen.has(key)) {
            seen.add(key);
            uniqueData.push(row);
        }
    }
    console.log(`After deduplication: ${uniqueData.length} unique rows`);
    
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
    
    // Save file
    const filePath = path.join(downloadPath, `${filePrefix}.csv`);
    fs.writeFileSync(filePath, csvContent);
    console.log(`Saved ${filePrefix}.csv (${uniqueData.length} rows, ${HEADERS.length} columns)`);
}

async function clickNextPage(page) {
    // Try multiple methods to click next page
    const result = await page.evaluate(() => {
        // Method 1: Look for > or › button directly
        const allButtons = document.querySelectorAll('button');
        for (const btn of allButtons) {
            const text = btn.textContent?.trim();
            // Look for the > symbol which is typically the next button
            if (text === '›' || text === '>' || text === '→') {
                if (!btn.disabled) {
                    btn.click();
                    return 'clicked > button';
                }
            }
        }
        
        // Method 2: aria-label
        const ariaSelectors = [
            '[aria-label="Go to next page"]',
            '[aria-label="Next page"]',
            '[aria-label="next page"]'
        ];
        for (const sel of ariaSelectors) {
            const btn = document.querySelector(sel);
            if (btn && !btn.disabled) {
                btn.click();
                return 'clicked aria-label button';
            }
        }
        
        // Method 3: Find pagination container and click the right-most enabled button
        const paginationContainer = document.querySelector('[class*="pagination"], [class*="Pagination"], nav[aria-label*="pagination"]');
        if (paginationContainer) {
            const buttons = paginationContainer.querySelectorAll('button:not([disabled])');
            if (buttons.length > 0) {
                // The "next" button is usually the last or second-to-last button
                const lastBtn = buttons[buttons.length - 1];
                const text = lastBtn.textContent?.trim();
                if (text === '›' || text === '>' || text === '>>' || text === '→' || text === '»' || text.includes('Last') || text.includes('Next')) {
                    lastBtn.click();
                    return 'clicked last pagination button';
                }
                // Try second to last
                if (buttons.length > 1) {
                    const secondLast = buttons[buttons.length - 2];
                    secondLast.click();
                    return 'clicked second-to-last button';
                }
            }
        }
        
        // Method 4: Look for SVG icons that look like arrows
        const svgButtons = document.querySelectorAll('button');
        for (const btn of svgButtons) {
            const svg = btn.querySelector('svg');
            if (svg && !btn.disabled) {
                const path = svg.querySelector('path');
                const d = path?.getAttribute('d') || '';
                // Right arrow paths typically have positive x movement
                if (d.includes('l') || d.includes('L')) {
                    // This might be an arrow, check position - if it's on the right side of pagination
                    const rect = btn.getBoundingClientRect();
                    if (rect.left > window.innerWidth / 2) {
                        btn.click();
                        return 'clicked SVG arrow button';
                    }
                }
            }
        }
        
        return 'no button found';
    });
    
    console.log(`  Next page click: ${result}`);
    return result !== 'no button found';
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
