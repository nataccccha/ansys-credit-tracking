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
        headless: false,  // Try with visible browser via xvfb
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080'
        ]
    });
    
    const page = await browser.newPage();
    
    // Make browser look more real
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Remove webdriver flag
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    
    page.setDefaultTimeout(60000);
    
    try {
        // LOGIN
        console.log('Navigating to ANSYS licensing portal...');
        await page.goto('https://licensing.ansys.com', { waitUntil: 'networkidle0', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));
        await page.screenshot({ path: 'debug-0-login-page.png' });
        
        const emailInput = await page.$('input[type="email"]') || 
                          await page.$('input[id="email"]') ||
                          await page.$('input:not([type="hidden"]):not([type="submit"])');
        
        if (emailInput) {
            await emailInput.click();
            await page.keyboard.type(USERNAME, { delay: 50 }); // Type slowly like human
            console.log('Email entered');
        }
        
        await page.click('button[type="submit"]');
        await new Promise(r => setTimeout(r, 5000));
        
        console.log('Entering password...');
        await page.waitForSelector('input[type="password"]', { timeout: 15000 });
        await page.keyboard.type(PASSWORD, { delay: 50 });
        await page.click('button[type="submit"]');
        
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
        console.log('Login successful!');
        await page.screenshot({ path: 'debug-1-after-login.png' });
        
        // Wait a bit then go to transactions
        await new Promise(r => setTimeout(r, 3000));
        
        console.log('Navigating to Usage Transactions...');
        await page.goto('https://licensing.ansys.com/transactions', { 
            waitUntil: 'networkidle0', 
            timeout: 120000 
        });
        
        // Wait for content to appear
        console.log('Waiting for page content...');
        try {
            await page.waitForFunction(
                () => !document.body.textContent.includes('Loading...') || 
                      document.querySelector('table') !== null,
                { timeout: 120000 }
            );
            console.log('Page loaded!');
        } catch (e) {
            console.log('Timeout waiting for page, continuing anyway...');
        }
        
        await page.screenshot({ path: 'debug-2-transactions.png', fullPage: true });
        
        // Log what we see
        const url = page.url();
        const title = await page.title();
        console.log('Current URL:', url);
        console.log('Page title:', title);
        
        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
        console.log('Page text:', bodyText);
        
        // DOWNLOAD YTD DATA
        console.log('=== Downloading YTD data ===');
        await selectDateRangeAndDownload(page, 'YTD', 'historical', downloadPath);
        
        // DOWNLOAD 5 DAYS DATA  
        console.log('=== Downloading 5 Days data ===');
        await selectDateRangeAndDownload(page, '5 Days', 'recent', downloadPath);
        
        console.log('All downloads complete!');
        
    } catch (error) {
        console.error('Error:', error.message);
        await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
        
        // Log page state
        const url = page.url();
        console.log('Error URL:', url);
        throw error;
    } finally {
        await browser.close();
    }
}

async function selectDateRangeAndDownload(page, dateOption, filePrefix, downloadPath) {
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
    
    console.log(`Selecting "${dateOption}"...`);
    
    const optionClicked = await page.evaluate((option) => {
        const elements = document.querySelectorAll('*');
        for (const el of elements) {
            if (el.textContent?.trim() === option && el.children.length === 0) {
                el.click();
                return true;
            }
        }
        return false;
    }, dateOption);
    
    console.log('Option clicked:', optionClicked);
    await new Promise(r => setTimeout(r, 4000));
    
    console.log('Clicking download...');
    
    const downloadClicked = await page.evaluate(() => {
        const elements = document.querySelectorAll('button, [role="button"], svg');
        for (const el of elements) {
            const html = el.outerHTML.toLowerCase();
            if (html.includes('download') || html.includes('export')) {
                el.closest('button')?.click() || el.click();
                return true;
            }
        }
        return false;
    });
    
    console.log('Download clicked:', downloadClicked);
    await new Promise(r => setTimeout(r, 10000));
    
    console.log('Files:', fs.readdirSync(downloadPath));
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
