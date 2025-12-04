const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const USERNAME = process.env.ANSYS_USERNAME;
const PASSWORD = process.env.ANSYS_PASSWORD;

if (!USERNAME || !PASSWORD) {
    console.error('Error: ANSYS_USERNAME and ANSYS_PASSWORD environment variables must be set');
    process.exit(1);
}

function getDateRanges() {
    const today = new Date();
    const ytdStart = new Date(today.getFullYear(), 0, 1);
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    
    const formatDate = (date) => {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${months[date.getMonth()]} ${String(date.getDate()).padStart(2, '0')} ${date.getFullYear()}`;
    };
    
    return {
        ytd: { start: formatDate(ytdStart), end: formatDate(today) },
        recent: { start: formatDate(weekAgo), end: formatDate(today) }
    };
}

async function downloadAnsysData() {
    const downloadPath = path.resolve('./data');
    
    if (!fs.existsSync(downloadPath)) {
        fs.mkdirSync(downloadPath, { recursive: true });
    }
    
    console.log('Starting browser...');
    const browser = await puppeteer.launch({
        headless: false,  // Set to 'new' for headless, false to watch it run
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadPath
    });
    
    try {
        // Step 1: Go to login page
        console.log('Navigating to ANSYS licensing portal...');
        await page.goto('https://licensing.ansys.com', { waitUntil: 'networkidle2' });
        
        // Step 2: Enter email
        console.log('Entering email...');
        await page.waitForSelector('input[type="email"], input[name="email"], input[id="email"]', { timeout: 15000 });
        await page.type('input[type="email"], input[name="email"], input[id="email"]', USERNAME);
        
        // Click Continue
        await page.click('button[type="submit"], button:has-text("Continue")');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(2000);
        
        // Step 3: Enter password
        console.log('Entering password...');
        await page.waitForSelector('input[type="password"]', { timeout: 15000 });
        await page.type('input[type="password"]', PASSWORD);
        
        // Click Continue
        await page.click('button[type="submit"], button:has-text("Continue")');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        console.log('Login successful!');
        
        // Step 4: Navigate to Usage Transactions
        console.log('Navigating to Usage Transactions...');
        await page.goto('https://licensing.ansys.com/transactions', { waitUntil: 'networkidle2' });
        await page.waitForTimeout(3000);
        
        const dateRanges = getDateRanges();
        
        // Download YTD data
        console.log(`Downloading YTD data (${dateRanges.ytd.start} to ${dateRanges.ytd.end})...`);
        await setDateRangeAndDownload(page, dateRanges.ytd.start, dateRanges.ytd.end, 'historical', downloadPath);
        
        // Download Recent data  
        console.log(`Downloading Recent data (${dateRanges.recent.start} to ${dateRanges.recent.end})...`);
        await setDateRangeAndDownload(page, dateRanges.recent.start, dateRanges.recent.end, 'recent', downloadPath);
        
        console.log('Downloads complete!');
        
    } catch (error) {
        console.error('Error during automation:', error);
        await page.screenshot({ path: 'error-screenshot.png' });
        throw error;
    } finally {
        await browser.close();
    }
}

async function setDateRangeAndDownload(page, startDate, endDate, filePrefix, downloadPath) {
    // Click on date range picker (the button showing "From: ... To: ...")
    console.log('Opening date picker...');
    await page.waitForSelector('button:has-text("From"), [class*="date-picker"], [class*="DateRange"]', { timeout: 10000 });
    
    const dateButton = await page.$('button:has-text("From")');
    if (dateButton) {
        await dateButton.click();
        await page.waitForTimeout(1000);
    }
    
    // Clear and set start date
    const inputs = await page.$$('input[type="text"], input[placeholder*="date"]');
    if (inputs.length >= 2) {
        // Start date
        await inputs[0].click({ clickCount: 3 });
        await inputs[0].type(startDate);
        
        // End date
        await inputs[1].click({ clickCount: 3 });
        await inputs[1].type(endDate);
    }
    
    // Click Apply or OK
    const applyBtn = await page.$('button:has-text("Apply"), button:has-text("OK"), button:has-text("Done")');
    if (applyBtn) {
        await applyBtn.click();
    }
    
    await page.waitForTimeout(3000); // Wait for table to reload
    
    // Click download button
    console.log('Clicking download...');
    const downloadBtn = await page.$('[aria-label*="download"], [title*="Download"], [class*="download"], button:has([class*="download"])');
    if (downloadBtn) {
        await downloadBtn.click();
    } else {
        // Try finding the icon in the top right of the table area
        const allButtons = await page.$$('button, [role="button"]');
        for (const btn of allButtons) {
            const html = await page.evaluate(el => el.outerHTML, btn);
            if (html.includes('download') || html.includes('export') || html.includes('Download')) {
                await btn.click();
                break;
            }
        }
    }
    
    // Wait for download
    await page.waitForTimeout(5000);
    
    // Rename downloaded file
    const files = fs.readdirSync(downloadPath);
    const csvFile = files.find(f => f.endsWith('.csv') && !f.startsWith('historical') && !f.startsWith('recent'));
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
