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
        
        // Enter email
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
        
        // Click Continue
        await page.evaluate(() => {
            const btn = document.querySelector('button[type="submit"]');
            if (btn) btn.click();
        });
        
        await new Promise(r => setTimeout(r, 5000));
        
        // Wait for and enter password
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
        
        // Click login
        await page.evaluate(() => {
            const btn = document.querySelector('button[type="submit"]');
            if (btn) btn.click();
        });
        
        await new Promise(r => setTimeout(r, 10000));
        console.log('Login successful!');
        
        // Navigate to transactions
        console.log('Navigating to Usage Transactions...');
        await page.goto('https://licensing.ansys.com/transactions', { waitUntil: 'networkidle0', timeout: 120000 });
        
        // Wait for content
        for (let i = 0; i < 30; i++) {
            const hasContent = await page.evaluate(() => {
                return document.body.innerText.includes('Start Time') || document.body.innerText.includes('From');
            });
            if (hasContent) break;
            await new Promise(r => setTimeout(r, 2000));
        }
        console.log('Transactions page loaded!');
        
        // SCRAPE YTD DATA
        console.log('=== Scraping YTD data ===');
        await scrapeData(page, 'YTD', 'historical', downloadPath);
        
        // SCRAPE 5 DAYS DATA
        console.log('=== Scraping 5 Days data ===');
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
    await new Promise(r => setTimeout(r, 5000));
    
    // Get total pages
    const pageInfo = await page.evaluate(() => {
        const text = document.body.innerText;
        const match = text.match(/Page \d+ of (\d+)/);
        return match ? parseInt(match[1]) : 1;
    });
    console.log(`Total pages: ${pageInfo}`);
    
    // Scrape all pages
    let allData = [];
    let headers = [];
    
    for (let pageNum = 1; pageNum <= pageInfo; pageNum++) {
        console.log(`Scraping page ${pageNum}/${pageInfo}...`);
        
        // Get table data from current page
        const pageData = await page.evaluate(() => {
            const rows = [];
            const headerCells = document.querySelectorAll('th, [role="columnheader"]');
            const headers = Array.from(headerCells).map(h => h.textContent?.trim() || '');
            
            const dataRows = document.querySelectorAll('tbody tr, [role="row"]');
            dataRows.forEach(row => {
                const cells = row.querySelectorAll('td, [role="cell"]');
                if (cells.length > 0) {
                    const rowData = Array.from(cells).map(c => c.textContent?.trim() || '');
                    rows.push(rowData);
                }
            });
            
            return { headers, rows };
        });
        
        if (pageNum === 1) {
            headers = pageData.headers;
        }
        allData = allData.concat(pageData.rows);
        
        // Go to next page if not last
        if (pageNum < pageInfo) {
            await page.evaluate(() => {
                const nextBtn = document.querySelector('[aria-label="next page"], [aria-label="Next page"], button:has-text(">")');
                if (nextBtn) {
                    nextBtn.click();
                } else {
                    // Try finding by text content
                    const buttons = document.querySelectorAll('button');
                    for (const btn of buttons) {
                        if (btn.textContent === '>' || btn.textContent === '›' || btn.getAttribute('aria-label')?.toLowerCase().includes('next')) {
                            btn.click();
                            break;
                        }
                    }
                }
            });
            await new Promise(r => setTimeout(r, 3000));
        }
    }
    
    console.log(`Scraped ${allData.length} rows`);
    
    // Convert to CSV
    const csvContent = [
        headers.join(','),
        ...allData.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    
    // Save file
    const filePath = path.join(downloadPath, `${filePrefix}.csv`);
    fs.writeFileSync(filePath, csvContent);
    console.log(`Saved ${filePrefix}.csv (${allData.length} rows)`);
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
