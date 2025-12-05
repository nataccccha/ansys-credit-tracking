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
        // STEP 1: Go to login page
        console.log('Navigating to ANSYS licensing portal...');
        await page.goto('https://licensing.ansys.com', { waitUntil: 'networkidle0', timeout: 60000 });
        await new Promise(r => setTimeout(r, 3000));
        await page.screenshot({ path: 'debug-01-initial.png' });
        
        // STEP 2: Enter email
        console.log('Looking for email field...');
        await page.waitForSelector('input', { timeout: 30000 });
        
        // Find the visible input field
        const emailEntered = await page.evaluate((email) => {
            const inputs = document.querySelectorAll('input');
            for (const input of inputs) {
                const type = input.type.toLowerCase();
                const rect = input.getBoundingClientRect();
                // Find visible, non-hidden input
                if (rect.width > 0 && rect.height > 0 && type !== 'hidden' && type !== 'submit') {
                    input.focus();
                    input.value = email;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    return { success: true, type: input.type, name: input.name };
                }
            }
            return { success: false };
        }, USERNAME);
        
        console.log('Email entry result:', emailEntered);
        await page.screenshot({ path: 'debug-02-email-entered.png' });
        
        // STEP 3: Click Continue
        console.log('Clicking Continue...');
        await page.evaluate(() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                const text = btn.textContent?.toLowerCase() || '';
                if (text.includes('continue') || text.includes('next') || text.includes('sign') || btn.type === 'submit') {
                    btn.click();
                    return true;
                }
            }
            // Try submit button
            const submit = document.querySelector('button[type="submit"], input[type="submit"]');
            if (submit) {
                submit.click();
                return true;
            }
            return false;
        });
        
        // Wait for password page
        console.log('Waiting for password page...');
        await new Promise(r => setTimeout(r, 5000));
        await page.screenshot({ path: 'debug-03-after-email-submit.png' });
        
        // STEP 4: Wait for password field
        console.log('Looking for password field...');
        
        // Wait up to 30 seconds for password field to appear
        let passwordFieldFound = false;
        for (let i = 0; i < 15; i++) {
            const hasPasswordField = await page.evaluate(() => {
                const pwdInput = document.querySelector('input[type="password"]');
                return pwdInput !== null;
            });
            
            if (hasPasswordField) {
                passwordFieldFound = true;
                console.log('Password field found after', (i + 1) * 2, 'seconds');
                break;
            }
            
            console.log(`Checking for password field... attempt ${i + 1}/15`);
            await new Promise(r => setTimeout(r, 2000));
        }
        
        await page.screenshot({ path: 'debug-04-password-page.png' });
        
        if (!passwordFieldFound) {
            // Log what's on the page
            const pageContent = await page.evaluate(() => document.body.innerText.substring(0, 1000));
            console.log('Page content:', pageContent);
            throw new Error('Password field not found after 30 seconds');
        }
        
        // STEP 5: Enter password
        console.log('Entering password...');
        const passwordEntered = await page.evaluate((pwd) => {
            const pwdInput = document.querySelector('input[type="password"]');
            if (pwdInput) {
                pwdInput.focus();
                pwdInput.value = pwd;
                pwdInput.dispatchEvent(new Event('input', { bubbles: true }));
                pwdInput.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
            return false;
        }, PASSWORD);
        
        console.log('Password entered:', passwordEntered);
        await page.screenshot({ path: 'debug-05-password-entered.png' });
        
        // STEP 6: Click Continue/Login
        console.log('Clicking login button...');
        await page.evaluate(() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                const text = btn.textContent?.toLowerCase() || '';
                if (text.includes('continue') || text.includes('sign in') || text.includes('log in') || btn.type === 'submit') {
                    btn.click();
                    return true;
                }
            }
            const submit = document.querySelector('button[type="submit"]');
            if (submit) submit.click();
            return false;
        });
        
        // Wait for navigation
        console.log('Waiting for login to complete...');
        await new Promise(r => setTimeout(r, 10000));
        await page.screenshot({ path: 'debug-06-after-login.png' });
        
        const currentUrl = page.url();
        console.log('Current URL after login:', currentUrl);
        
        if (currentUrl.includes('licensing.ansys.com') && !currentUrl.includes('login')) {
            console.log('Login successful!');
        } else {
            console.log('Login may have failed, continuing anyway...');
        }
        
        // STEP 7: Navigate to transactions
        console.log('Navigating to Usage Transactions...');
        await page.goto('https://licensing.ansys.com/transactions', { waitUntil: 'networkidle0', timeout: 120000 });
        
        // Wait for content
        console.log('Waiting for transactions page...');
        for (let i = 0; i < 30; i++) {
            const hasContent = await page.evaluate(() => {
                const text = document.body.innerText || '';
                return text.includes('Start Time') || text.includes('Usage Transaction') || text.includes('From');
            });
            
            if (hasContent) {
                console.log('Transactions page loaded!');
                break;
            }
            
            console.log(`Waiting for content... ${i + 1}/30`);
            await new Promise(r => setTimeout(r, 2000));
        }
        
        await page.screenshot({ path: 'debug-07-transactions.png', fullPage: true });
        
        // Download data
        console.log('=== Downloading YTD data ===');
        await selectDateRangeAndDownload(page, 'YTD', 'historical', downloadPath);
        
        console.log('=== Downloading 5 Days data ===');
        await selectDateRangeAndDownload(page, '5 Days', 'recent', downloadPath);
        
        console.log('All downloads complete!');
        
    } catch (error) {
        console.error('Error:', error.message);
        await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
        throw error;
    } finally {
        await browser.close();
    }
}

async function selectDateRangeAndDownload(page, dateOption, filePrefix, downloadPath) {
    // Click date picker
    const datePickerClicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
            if (btn.textContent && btn.textContent.includes('From') && btn.textContent.includes('To')) {
                btn.click();
                return true;
            }
        }
        return false;
    });
    console.log('Date picker clicked:', datePickerClicked);
    await new Promise(r => setTimeout(r, 2000));
    
    // Select option
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
    console.log(`${dateOption} clicked:`, optionClicked);
    await new Promise(r => setTimeout(r, 4000));
    
    // Click download
    const downloadClicked = await page.evaluate(() => {
        const elements = document.querySelectorAll('button, [role="button"], svg');
        for (const el of elements) {
            const html = el.outerHTML.toLowerCase();
            if (html.includes('download') || html.includes('export')) {
                const btn = el.closest('button') || el;
                btn.click();
                return true;
            }
        }
        return false;
    });
    console.log('Download clicked:', downloadClicked);
    await new Promise(r => setTimeout(r, 10000));
    
    console.log('Files in data folder:', fs.readdirSync(downloadPath));
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
