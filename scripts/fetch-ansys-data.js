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
    var downloadPath = path.resolve('./data');
    
    if (!fs.existsSync(downloadPath)) {
        fs.mkdirSync(downloadPath, { recursive: true });
    }
    
    console.log('Starting browser...');
    var browser = await puppeteer.launch({
        headless: false,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080'
        ]
    });
    
    var page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    
    await page.evaluateOnNewDocument(function() {
        Object.defineProperty(navigator, 'webdriver', { get: function() { return false; } });
    });
    
    var historicalRows = 0;
    var recentRows = 0;
    
    try {
        console.log('Navigating to ANSYS licensing portal...');
        await page.goto('https://licensing.ansys.com', { waitUntil: 'networkidle0', timeout: 60000 });
        await new Promise(function(r) { setTimeout(r, 3000); });
        
        // Enter email using Puppeteer's type method
        console.log('Entering email...');
        
        // Wait for email input to appear
        await page.waitForSelector('input[type="email"], input[type="text"], input[name="email"], input[placeholder*="mail"]', { timeout: 30000 });
        
        // Try multiple selectors for email input
        var emailEntered = await page.evaluate(function(email) {
            // Try various selectors
            var selectors = [
                'input[type="email"]',
                'input[name="email"]',
                'input[placeholder*="mail"]',
                'input[placeholder*="Mail"]',
                'input[autocomplete="email"]',
                'input[autocomplete="username"]'
            ];
            
            for (var i = 0; i < selectors.length; i++) {
                var input = document.querySelector(selectors[i]);
                if (input) {
                    input.focus();
                    input.value = email;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    return 'found with selector: ' + selectors[i];
                }
            }
            
            // Fallback: find any visible text input
            var inputs = document.querySelectorAll('input');
            for (var i = 0; i < inputs.length; i++) {
                var input = inputs[i];
                var rect = input.getBoundingClientRect();
                var type = input.type || 'text';
                if (rect.width > 100 && rect.height > 20 && (type === 'text' || type === 'email')) {
                    input.focus();
                    input.value = email;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    return 'found visible input at index ' + i;
                }
            }
            
            return 'no email input found';
        }, USERNAME);
        
        console.log('Email entry: ' + emailEntered);
        
        // Take screenshot to verify
        await page.screenshot({ path: 'debug-01-after-email.png' });
        
        // Click Continue button
        await new Promise(function(r) { setTimeout(r, 1000); });
        
        var continueClicked = await page.evaluate(function() {
            // Look for Continue button
            var buttons = document.querySelectorAll('button');
            for (var i = 0; i < buttons.length; i++) {
                var btn = buttons[i];
                var text = (btn.textContent || '').trim().toLowerCase();
                if (text === 'continue' || text === 'next' || text === 'submit') {
                    btn.click();
                    return 'clicked button: ' + text;
                }
            }
            
            // Try submit button
            var submitBtn = document.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.click();
                return 'clicked submit button';
            }
            
            return 'no continue button found';
        });
        
        console.log('Continue button: ' + continueClicked);
        
        await new Promise(function(r) { setTimeout(r, 5000); });
        
        // Take screenshot after clicking continue
        await page.screenshot({ path: 'debug-02-after-continue.png' });
        
        console.log('Waiting for password field...');
        for (var i = 0; i < 15; i++) {
            var hasPassword = await page.evaluate(function() { return !!document.querySelector('input[type="password"]'); });
            if (hasPassword) {
                console.log('Password field found!');
                break;
            }
            console.log('Waiting for password... attempt ' + (i + 1));
            await new Promise(function(r) { setTimeout(r, 2000); });
        }
        
        console.log('Entering password...');
        var passwordEntered = await page.evaluate(function(pwd) {
            var pwdInput = document.querySelector('input[type="password"]');
            if (pwdInput) {
                pwdInput.focus();
                pwdInput.value = pwd;
                pwdInput.dispatchEvent(new Event('input', { bubbles: true }));
                pwdInput.dispatchEvent(new Event('change', { bubbles: true }));
                return 'password entered';
            }
            return 'no password field found';
        }, PASSWORD);
        
        console.log('Password entry: ' + passwordEntered);
        
        // Click sign in / submit
        await new Promise(function(r) { setTimeout(r, 1000); });
        
        var signInClicked = await page.evaluate(function() {
            var buttons = document.querySelectorAll('button');
            for (var i = 0; i < buttons.length; i++) {
                var btn = buttons[i];
                var text = (btn.textContent || '').trim().toLowerCase();
                if (text.includes('sign in') || text.includes('login') || text.includes('log in') || text === 'continue' || text === 'submit') {
                    btn.click();
                    return 'clicked: ' + text;
                }
            }
            
            var submitBtn = document.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.click();
                return 'clicked submit';
            }
            
            return 'no sign in button found';
        });
        
        console.log('Sign in button: ' + signInClicked);
        
        await new Promise(function(r) { setTimeout(r, 10000); });
        
        // Take screenshot after login
        await page.screenshot({ path: 'debug-03-after-login.png' });
        
        console.log('Current URL: ' + page.url());
        console.log('Login successful!');
        
        // RECENT DATA FIRST
        console.log('=== Scraping 5 Days data ===');
        await page.goto('https://licensing.ansys.com/transactions', { waitUntil: 'networkidle0', timeout: 120000 });
        
        // Wait for page to load
        console.log('Waiting for transactions page...');
        await new Promise(function(r) { setTimeout(r, 5000); });
        
        await page.screenshot({ path: 'debug-04-transactions.png' });
        
        await waitForTableLoad(page);
        recentRows = await scrapeData(page, '5 Days', 'recent', downloadPath);
        
        // HISTORICAL DATA
        console.log('=== Scraping 1 Year data ===');
        await page.goto('https://licensing.ansys.com/transactions', { waitUntil: 'networkidle0', timeout: 120000 });
        await new Promise(function(r) { setTimeout(r, 5000); });
        await waitForTableLoad(page);
        historicalRows = await scrapeData(page, '1 Year', 'historical', downloadPath);
        
        // Save last updated timestamp
        var lastUpdated = {
            timestamp: new Date().toISOString(),
            historicalRows: historicalRows,
            recentRows: recentRows
        };
        fs.writeFileSync(path.join(downloadPath, 'last_updated.json'), JSON.stringify(lastUpdated, null, 2));
        console.log('Saved last_updated.json: ' + lastUpdated.timestamp);
        
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
    console.log('Waiting for table to load...');
    for (var i = 0; i < 30; i++) {
        var hasContent = await page.evaluate(function() {
            return document.body.innerText.includes('Start Time') || 
                   document.querySelectorAll('[role="row"]').length > 1;
        });
        if (hasContent) {
            console.log('Table content found!');
            break;
        }
        await new Promise(function(r) { setTimeout(r, 2000); });
    }
    console.log('Page loaded!');
}

async function scrapeData(page, dateOption, filePrefix, downloadPath) {
    // Check page state
    var pageState = await page.evaluate(function() {
        return {
            hasFrom: document.body.innerText.includes('From'),
            hasStartTime: document.body.innerText.includes('Start Time'),
            rowCount: document.querySelectorAll('[role="row"]').length
        };
    });
    console.log('Page state: ' + JSON.stringify(pageState));
    
    // Click date picker
    var datePickerClicked = await page.evaluate(function() {
        var buttons = document.querySelectorAll('button');
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            var text = btn.textContent || '';
            if (text.includes('From') && text.includes('To')) {
                btn.click();
                return 'clicked';
            }
        }
        return 'not found';
    });
    console.log('Date picker: ' + datePickerClicked);
    await new Promise(function(r) { setTimeout(r, 2000); });
    
    // Select date option
    var optionClicked = await page.evaluate(function(option) {
        var elements = document.querySelectorAll('*');
        for (var i = 0; i < elements.length; i++) {
            var el = elements[i];
            if (el.textContent && el.textContent.trim() === option && el.children.length === 0) {
                el.click();
                return 'clicked ' + option;
            }
        }
        return 'not found: ' + option;
    }, dateOption);
    console.log('Date option: ' + optionClicked);
    
    await new Promise(function(r) { setTimeout(r, 5000); });
    
    // Get page info
    var pageInfo = await page.evaluate(function() {
        var text = document.body.innerText;
        var rowMatch = text.match(/(\d+)\s+to\s+(\d+)\s+of\s+([\d,]+)/i);
        var totalRows = rowMatch ? parseInt(rowMatch[3].replace(/,/g, '')) : 0;
        var pageMatch = text.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
        var totalPages = pageMatch ? parseInt(pageMatch[2]) : 1;
        return { totalPages: totalPages, totalRows: totalRows };
    });
    
    var totalPages = pageInfo.totalPages;
    var totalRows = pageInfo.totalRows;
    
    console.log('Total pages: ' + totalPages + ', Total rows expected: ' + totalRows);
    
    var allData = [];
    
    for (var pageNum = 1; pageNum <= totalPages; pageNum++) {
        if (pageNum % 20 === 1 || pageNum === totalPages) {
            console.log('Scraping page ' + pageNum + '/' + totalPages + '...');
        }
        
        var pageData = await page.evaluate(function(numCols) {
            var rows = [];
            var rowElements = document.querySelectorAll('[role="row"]');
            
            for (var i = 0; i < rowElements.length; i++) {
                if (i === 0) continue;
                var row = rowElements[i];
                
                var cells = row.querySelectorAll('[role="cell"]');
                if (cells.length === 0) cells = row.querySelectorAll('[role="gridcell"]');
                
                if (cells.length > 0) {
                    var rowData = [];
                    for (var j = 0; j < Math.min(cells.length, numCols); j++) {
                        var text = (cells[j].textContent || '').trim().replace(/\n/g, ' ').replace(/\s+/g, ' ');
                        rowData.push(text);
                    }
                    rows.push(rowData);
                }
            }
            
            return rows;
        }, HEADERS.length);
        
        allData = allData.concat(pageData);
        
        if (pageNum < totalPages) {
            await page.evaluate(function() {
                var nextBtn = document.querySelector('[aria-label="Next Page"]');
                if (nextBtn && !nextBtn.classList.contains('ag-disabled')) {
                    nextBtn.click();
                }
            });
            await new Promise(function(r) { setTimeout(r, 2000); });
        }
    }
    
    console.log('Scraped ' + allData.length + ' rows total (expected ' + totalRows + ')');
    
    var uniqueData = [];
    var seen = {};
    for (var i = 0; i < allData.length; i++) {
        var key = allData[i].join('|');
        if (!seen[key]) {
            seen[key] = true;
            uniqueData.push(allData[i]);
        }
    }
    console.log('After dedup: ' + uniqueData.length + ' unique rows');
    
    var csvLines = [HEADERS.join(',')];
    for (var i = 0; i < uniqueData.length; i++) {
        var row = uniqueData[i];
        while (row.length < HEADERS.length) row.push('');
        var csvRow = row.slice(0, HEADERS.length).map(function(cell) {
            return '"' + (cell || '').replace(/"/g, '""') + '"';
        }).join(',');
        csvLines.push(csvRow);
    }
    
    var csvContent = csvLines.join('\n');
    var filePath = path.join(downloadPath, filePrefix + '.csv');
    fs.writeFileSync(filePath, csvContent);
    console.log('Saved ' + filePrefix + '.csv (' + uniqueData.length + ' rows)');
    
    return uniqueData.length;
}

downloadAnsysData()
    .then(function() {
        console.log('Done!');
        process.exit(0);
    })
    .catch(function(error) {
        console.error('Failed:', error);
        process.exit(1);
    });
