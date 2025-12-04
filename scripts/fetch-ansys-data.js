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
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadPath
    });
    
    try {
        // LOGIN
        console.log('Navigating to ANSYS licensing portal...');
        await page.goto('https://licensing.ansys.com', { waitUntil: 'networkidle2', timeout: 60000 });
        
        console.log('Current URL:', page.url());
        console.log('Waiting for page to fully load...');
        await new Promise(r => setTimeout(r, 5000));
        
        // Take screenshot to debug
        await page.screenshot({ path: 'debug-login-page.png' });
        console.log('Screenshot saved as debug-login-page.png');
        
        // Try multiple selectors for email
        console.log('Looking for email input...');
        const emailSelectors = [
            'input[type="email"]',
            'input[name="email"]',
            'input[id="email"]',
            'input[name="username"]',
            'input[id="username"]',
            'input[placeholder*="email"]',
            'input[placeholder*="Email"]',
            'input[autocomplete="email"]',
            'input[autocomplete="username"]',
            'input'
        ];
        
        let emailInput = null;
        for (const selector of emailSelectors) {
            console.log(`Trying selector: ${selector}`);
            emailInput = await page.$(selector);
            if (emailInput) {
                const inputType = await page.evaluate(el => el.type, emailInput);
                const inputName = await page.evaluate(el => el.name, emailInput);
                console.log(`Found input with type="${inputType}", name="${inputName}"`);
                if (inputType !== 'hidden' && inputType !== 'submit') {
                    console.log(`Using selector: ${selector}`);
                    break;
                }
                emailInput = null;
            }
        }
        
        if (!emailInput) {
            // List all inputs on the page for debugging
            const allInputs = await page.$$('input');
            console.log(`Found ${allInputs.length} input elements on page`);
            for (let i = 0; i < allInputs.length; i++) {
                const type = await page.evaluate(el => el.type, allInputs[i]);
                const name = await page.evaluate(el => el.name, allInputs[i]);
                const id = await page.evaluate(el => el.id, allInputs[i]);
                console.log(`Input ${i}: type="${type}", name="${name}", id="${id}"`);
            }
            throw new Error('Could not find email input field');
        }
        
        console.log('Entering email...');
        await emailInput.click();
        await emailInput.type(USERNAME);
        
        // Find and click submit button
        console.log('Looking for submit button...');
        const submitBtn = await page.$('button[type="submit"]');
        if (submitBtn) {
            await submitBtn.click();
        } else {
            // Try clicking any button with "Continue" or "Next" text
            const buttons = await page.$$('button');
            for (const btn of buttons) {
                const text = await page.evaluate(el => el.textContent, btn);
                if (text && (text.includes('Continue') || text.includes('Next') || text.includes('Sign'))) {
                    await btn.click();
                    break;
                }
            }
        }
        
        await new Promise(r => setTimeout(r, 5000));
        await page.screenshot({ path: 'debug-after-email.png' });
        
        console.log('Entering password...');
        await page.waitForSelector('input[type="password"]', { timeout: 15000 });
        await page.type('input[type="password"]', PASSWORD);
        
        const submitBtn2 = await page.$('button[type="submit"]');
        if (submitBtn2) {
            await submitBtn2.click();
        }
        
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        console.log('Login successful!');
        
        // GO TO TRANSACTIONS
        console.log('Navigating to Usage Transactions...');
        await page.goto('https://licensing.ansys.com/transactions', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 3000));
        
        // DOWNLOAD YTD DATA
        console.log('Downloading YTD data...');
        await selectDateRangeAndDownload(page, 'YTD', 'historical', downloadPath);
        
        // DOWNLOAD 5 DAYS DATA
        console.log('Downloading 5 Days data...');
        await selectDateRangeAndDownload(page, '5 Days', 'recent', downloadPath);
        
        console.log('All downloads complete!');
        
    } catch (error) {
        console.error('Error during automation:', error);
        await page.screenshot({ path: 'error-screenshot.png' });
        throw error;
    } finally {
        await browser.close();
    }
}

async function selectDateRangeAndDownload(page, dateOption, filePrefix, downloadPath) {
    // Click the date range button
    console.log('Opening date picker...');
    const buttons = await page.$$('button');
    for (const btn of buttons) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text && text.includes('From') && text.includes('To')) {
            await btn.click();
            break;
        }
    }
    
    await new Promise(r => setTimeout(r, 1500));
    
    // Click on the date option
    console.log(`Selecting "${dateOption}"...`);
    const allElements = await page.$$('div, li, span, button, p');
    for (const el of allElements) {
        const text = await page.evaluate(e => e.textContent?.trim(), el);
        if (text === dateOption) {
            await el.click();
            console.log(`Clicked "${dateOption}"`);
            break;
        }
    }
    
    await new Promise(r => setTimeout(r, 3000));
    
    // Click download button
    console.log('Clicking download button...');
    const allButtons = await page.$$('button');
    for (const btn of allButtons) {
        const html = await page.evaluate(el => el.innerHTML.toLowerCase(), btn);
        const ariaLabel = await page.evaluate(el => el.getAttribute('aria-label')?.toLowerCase() || '', btn);
        if (html.includes('download') || ariaLabel.includes('download')) {
            await btn.click();
            console.log('Download clicked!');
            break;
        }
    }
    
    await new Promise(r => setTimeout(r, 10000));
    
    // Rename file
    const files = fs.readdirSync(downloadPath);
    console.log('Files:', files);
    
    const csvFile = files.find(f => 
        f.endsWith('.csv') && 
        f.includes('ANSYS') &&
        !f.startsWith('historical') && 
        !f.startsWith('recent')
    );
    
    if (csvFile) {
        const oldPath = path.join(downloadPath, csvFile);
        const newPath = path.join(downloadPath, `${filePrefix}.csv`);
        if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
        fs.renameSync(oldPath, newPath);
        console.log(`Saved as ${filePrefix}.csv`);
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
