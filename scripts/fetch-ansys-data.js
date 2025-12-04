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
    
    console.log('Download path:', downloadPath);
    console.log('Starting browser...');
    
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Set download behavior - this bypasses "Save As" dialog
    const client = await page.target().createCDPSession();
    await client.send('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadPath,
        eventsEnabled: true
    });
    
    try {
        // LOGIN
        console.log('Navigating to ANSYS licensing portal...');
        await page.goto('https://licensing.ansys.com', { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));
        
        // Find and fill email
        console.log('Looking for email input...');
        const emailInput = await page.$('input[type="email"]') || 
                          await page.$('input[name="email"]') ||
                          await page.$('input[name="username"]') ||
                          await page.$('input:not([type="hidden"]):not([type="submit"])');
        
        if (emailInput) {
            await emailInput.click();
            await emailInput.type(USERNAME);
            console.log('Email entered');
        } else {
            throw new Error('Could not find email input');
        }
        
        // Click continue
        await page.click('button[type="submit"]');
        await new Promise(r => setTimeout(r, 5000));
        
        // Enter password
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
        
        // List existing files before download
        console.log('Files before download:', fs.readdirSync(downloadPath));
        
        // DOWNLOAD YTD DATA
        console.log('=== Downloading YTD data ===');
        await selectDateRangeAndDownload(page, 'YTD', 'historical', downloadPath);
        
        // DOWNLOAD 5 DAYS DATA
        console.log('=== Downloading 5 Days data ===');
        await selectDateRangeAndDownload(page, '5 Days', 'recent', downloadPath);
        
        // List files after download
        console.log('Files after all downloads:', fs.readdirSync(downloadPath));
        
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
    // Get files before this download
    const filesBefore = fs.readdirSync(downloadPath);
    console.log('Files before:', filesBefore);
    
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
    let found = false;
    for (const el of allElements) {
        const text = await page.evaluate(e => e.textContent?.trim(), el);
        if (text === dateOption) {
            await el.click();
            console.log(`Clicked "${dateOption}"`);
            found = true;
            break;
        }
    }
    if (!found) {
        console.log(`Warning: Could not find "${dateOption}" option`);
    }
    
    await new Promise(r => setTimeout(r, 4000));
    
    // Click download button
    console.log('Looking for download button...');
    const allButtons = await page.$$('button, [role="button"]');
    let downloadClicked = false;
    for (const btn of allButtons) {
        const html = await page.evaluate(el => el.outerHTML.toLowerCase(), btn);
        if (html.includes('download') || html.includes('export') || html.includes('filedownload')) {
            console.log('Found download button, clicking...');
            await btn.click();
            downloadClicked = true;
            break;
        }
    }
    
    if (!downloadClicked) {
        console.log('Warning: Could not find download button');
        await page.screenshot({ path: `debug-${filePrefix}-nodownload.png` });
    }
    
    // Wait for download
    console.log('Waiting for download to complete...');
    await new Promise(r => setTimeout(r, 15000));
    
    // Get files after download
    const filesAfter = fs.readdirSync(downloadPath);
    console.log('Files after:', filesAfter);
    
    // Find new file
    const newFile = filesAfter.find(f => !filesBefore.includes(f) && f.endsWith('.csv'));
    
    if (newFile) {
        const oldPath = path.join(downloadPath, newFile);
        const newPath = path.join(downloadPath, `${filePrefix}.csv`);
        if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
        fs.renameSync(oldPath, newPath);
        console.log(`SUCCESS: Renamed "${newFile}" to "${filePrefix}.csv"`);
    } else {
        console.log(`Warning: No new CSV file found for ${filePrefix}`);
        
        // Try to find any ANSYS file that might work
        const anyAnsysFile = filesAfter.find(f => 
            f.toLowerCase().includes('ansys') && 
            f.endsWith('.csv') &&
            f !== 'historical.csv' &&
            f !== 'recent.csv'
        );
        
        if (anyAnsysFile) {
            const oldPath = path.join(downloadPath, anyAnsysFile);
            const newPath = path.join(downloadPath, `${filePrefix}.csv`);
            if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
            fs.renameSync(oldPath, newPath);
            console.log(`SUCCESS (fallback): Renamed "${anyAnsysFile}" to "${filePrefix}.csv"`);
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
