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
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--window-size=1920,1080'
        ]
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Set a longer default timeout
    page.setDefaultTimeout(60000);
    
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
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
        console.log('Login successful!');
        
        // GO TO TRANSACTIONS - use click navigation instead of direct URL
        console.log('Navigating to Usage Transactions...');
        
        // Try clicking on the sidebar menu instead of direct navigation
        await page.goto('https://licensing.ansys.com', { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));
        
        // Look for "Elastic Reporting" or "Usage Transactions" link
        const navClicked = await page.evaluate(() => {
            const links = document.querySelectorAll('a, button, div, span');
            for (const link of links) {
                const text = link.textContent?.toLowerCase() || '';
                if (text.includes('usage transactions') || text.includes('elastic reporting')) {
                    link.click();
                    return text;
                }
            }
            return null;
        });
        console.log('Clicked nav:', navClicked);
        
        await new Promise(r => setTimeout(r, 3000));
        
        // Now try clicking "Usage Transactions" specifically
        await page.evaluate(() => {
            const links = document.querySelectorAll('a, button, div, span');
            for (const link of links) {
                const text = link.textContent?.trim();
                if (text === 'Usage Transactions') {
                    link.click();
                    return;
                }
            }
        });
        
        // Wait for the page to load - look for specific elements
        console.log('Waiting for transactions page to load...');
        
        // Wait up to 60 seconds for the table or date picker to appear
        let loaded = false;
        for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 2000));
            
            const hasContent = await page.evaluate(() => {
                // Check if loading spinner is gone and content is visible
                const loading = document.body.textContent?.includes('Loading...');
                const hasTable = document.querySelector('table') !== null;
                const hasDatePicker = document.body.textContent?.includes('From:') || 
                                     document.body.textContent?.includes('From ');
                return !loading || hasTable || hasDatePicker;
            });
            
            console.log(`Check ${i + 1}/30: Content loaded = ${hasContent}`);
            
            if (hasContent) {
                loaded = true;
                break;
            }
        }
        
        await page.screenshot({ path: 'debug-1-after-waiting.png', fullPage: true });
        
        if (!loaded) {
            console.log('Page did not fully load, trying direct URL...');
            await page.goto('https://licensing.ansys.com/transactions', { 
                waitUntil: 'domcontentloaded', 
                timeout: 60000 
            });
            
            // Wait more
            for (let i = 0; i < 15; i++) {
                await new Promise(r => setTimeout(r, 2000));
                const stillLoading = await page.evaluate(() => {
                    return document.body.textContent?.includes('Loading...');
                });
                console.log(`Direct URL check ${i + 1}/15: Still loading = ${stillLoading}`);
                if (!stillLoading) break;
            }
        }
        
        await page.screenshot({ path: 'debug-2-final-state.png', fullPage: true });
        
        // Log page content for debugging
        const pageText = await page.evaluate(() => document.body.innerText?.substring(0, 1000));
        console.log('Page content preview:', pageText);
        
        // DOWNLOAD YTD DATA
        console.log('=== Downloading YTD data ===');
        await selectDateRangeAndDownload(page, 'YTD', 'historical', downloadPath);
        
        // DOWNLOAD 5 DAYS DATA  
        console.log('=== Downloading 5 Days data ===');
        await selectDateRangeAndDownload(page, '5 Days', 'recent', downloadPath);
        
        console.log('All downloads complete!');
        
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
    
    // Click on the date option
    console.log(`Looking for "${dateOption}" option...`);
    
    const optionClicked = await page.evaluate((option) => {
        const elements = document.querySelectorAll('div, li, span, p, a, button');
        for (const el of elements) {
            const text = el.textContent?.trim();
            if (text === option) {
                el.click();
                return true;
            }
        }
        return false;
    }, dateOption);
    
    console.log('Option clicked:', optionClicked);
    await new Promise(r => setTimeout(r, 4000));
    
    // Click download button
    console.log('Looking for download button...');
    
    const downloadClicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, [role="button"]');
        for (const btn of buttons) {
            const html = btn.outerHTML.toLowerCase();
            const aria = btn.getAttribute('aria-label')?.toLowerCase() || '';
            const title = btn.getAttribute('title')?.toLowerCase() || '';
            if (html.includes('download') || aria.includes('download') || title.includes('download')) {
                btn.click();
                return true;
            }
        }
        return false;
    });
    
    console.log('Download clicked:', downloadClicked);
    await new Promise(r => setTimeout(r, 10000));
    
    // Check files
    const files = fs.readdirSync(downloadPath);
    console.log('Files:', files);
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
