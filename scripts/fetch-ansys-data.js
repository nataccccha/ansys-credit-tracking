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
    
    // Set up auto-download (no save dialog)
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadPath
    });
    
    try {
        // LOGIN
        console.log('Navigating to ANSYS licensing portal...');
        await page.goto('https://licensing.ansys.com', { waitUntil: 'networkidle2' });
        
        console.log('Entering email...');
        await page.waitForSelector('input[type="email"]', { timeout: 15000 });
        await page.type('input[type="email"]', USERNAME);
        await page.click('button[type="submit"]');
        await new Promise(r => setTimeout(r, 3000));
        
        console.log('Entering password...');
        await page.waitForSelector('input[type="password"]', { timeout: 15000 });
        await page.type('input[type="password"]', PASSWORD);
        await page.click('button[type="submit"]');
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
    // Click the date range button (the "From: ... To: ..." button)
    console.log('Opening date picker...');
    const dateButton = await page.waitForSelector('button:has-text("From"), button:has-text("To:")', { timeout: 10000 }).catch(() => null);
    
    if (!dateButton) {
        // Try finding by looking for button with calendar icon or date text
        const buttons = await page.$$('button');
        for (const btn of buttons) {
            const text = await page.evaluate(el => el.textContent, btn);
            if (text && text.includes('From') && text.includes('To')) {
                await btn.click();
                break;
            }
        }
    } else {
        await dateButton.click();
    }
    
    await new Promise(r => setTimeout(r, 1000));
    
    // Click on the date option (YTD, 5 Days, etc.)
    console.log(`Selecting "${dateOption}"...`);
    const options = await page.$$('div, li, span, button');
    for (const option of options) {
        const text = await page.evaluate(el => el.textContent?.trim(), option);
        if (text === dateOption) {
            await option.click();
            console.log(`Clicked "${dateOption}"`);
            break;
        }
    }
    
    await new Promise(r => setTimeout(r, 3000)); // Wait for table to reload
    
    // Click download button
    console.log('Clicking download button...');
    
    // Look for the download icon/button in the top right
    const downloadSelectors = [
        '[aria-label*="download"]',
        '[aria-label*="Download"]', 
        '[title*="Download"]',
        '[data-testid*="download"]',
        'button svg[data-testid="FileDownloadIcon"]',
        'button svg[data-icon="download"]'
    ];
    
    let clicked = false;
    for (const selector of downloadSelectors) {
        const btn = await page.$(selector);
        if (btn) {
            await btn.click();
            clicked = true;
            console.log('Download button clicked!');
            break;
        }
    }
    
    if (!clicked) {
        // Try finding by icon content
        const allButtons = await page.$$('button');
        for (const btn of allButtons) {
            const html = await page.evaluate(el => el.innerHTML.toLowerCase(), btn);
            const ariaLabel = await page.evaluate(el => el.getAttribute('aria-label')?.toLowerCase() || '', btn);
            if (html.includes('download') || html.includes('filedownload') || ariaLabel.includes('download')) {
                await btn.click();
                console.log('Download button clicked (found by content)!');
                clicked = true;
                break;
            }
        }
    }
    
    // Wait for download to complete
    console.log('Waiting for download...');
    await new Promise(r => setTimeout(r, 10000));
    
    // Rename the downloaded file
    const files = fs.readdirSync(downloadPath);
    console.log('Files in download folder:', files);
    
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
        console.log(`Renamed "${csvFile}" to "${filePrefix}.csv"`);
    } else {
        console.log('Warning: No new CSV file found to rename');
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
