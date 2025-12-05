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
    
    // DEBUG: Log ALL buttons on page
    if (filePrefix === 'recent') { // Only debug once
        const allButtonsInfo = await page.evaluate(() => {
            const buttons = document.querySelectorAll('button');
            return Array.from(buttons).map((btn, i) => {
                const rect = btn.getBoundingClientRect();
                return {
                    i,
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    w: Math.round(rect.width),
                    h: Math.round(rect.height),
                    disabled: btn.disabled,
                    aria: btn.getAttribute('aria-label'),
                    text: btn.innerText?.substring(0, 20).replace(/\n/g, ' '),
                    hasSvg: btn.querySelector('svg') !== null
                };
            }).filter(b => b.y > 500); // Only buttons in lower half of page
        });
        console.log('Buttons in lower half of page:');
        allButtonsInfo.forEach(b => {
            console.log(`  [${b.i}] x:${b.x} y:${b.y} ${b.w}x${b.h} aria:"${b.aria}" text:"${b.text}" svg:${b.hasSvg} disabled:${b.disabled}`);
        });
    }
    
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
            // Try clicking by aria-label using Puppeteer's native click
            let clicked = false;
            
            // Method 1: Try aria-label selectors
            const ariaSelectors = [
                'button[aria-label="Go to next page"]',
                'button[aria-label="Next page"]', 
                'button[aria-label="next page"]',
                'button[aria-label*="next"]',
                'button[aria-label*="Next"]'
            ];
            
            for (const selector of ariaSelectors) {
                try {
                    const btn = await page.$(selector);
                    if (btn) {
                        const isDisabled = await btn.evaluate(el => el.disabled);
                        if (!isDisabled) {
                            await btn.click();
                            clicked = true;
                            console.log(`  Clicked: ${selector}`);
                            break;
                        }
                    }
                } catch (e) {}
            }
            
            // Method 2: Click by index - find button with specific position
            if (!clicked) {
                const nextBtnIndex = await page.evaluate(() => {
                    const buttons = document.querySelectorAll('button');
                    for (let i = 0; i < buttons.length; i++) {
                        const btn = buttons[i];
                        const aria = btn.getAttribute('aria-label') || '';
                        if (aria.toLowerCase().includes('next') && !btn.disabled) {
                            return i;
                        }
                    }
                    return -1;
                });
                
                if (nextBtnIndex >= 0) {
                    const buttons = await page.$$('button');
                    await buttons[nextBtnIndex].click();
                    clicked = true;
                    console.log(`  Clicked button index ${nextBtnIndex}`);
                }
            }
            
            // Method 3: Use keyboard - Tab to pagination and press right arrow
            if (!clicked) {
                // Click somewhere on page first to focus
                await page.keyboard.press('Tab');
                await page.keyboard.press('Tab');
                await page.keyboard.press('Tab');
                // Try pressing Enter on what might be the next button
                console.log(`  Trying keyboard navigation...`);
            }
            
            if (!clicked) {
                console.log(`  WARNING: Could not find next button`);
            }
            
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
