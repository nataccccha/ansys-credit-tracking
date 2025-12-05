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
        
        console.log('Entering email...');
        await page.evaluate(function(email) {
            var inputs = document.querySelectorAll('input');
            for (var i = 0; i < inputs.length; i++) {
                var input = inputs[i];
                var rect = input.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0 && input.type !== 'hidden' && input.type !== 'submit') {
                    input.focus();
                    input.value = email;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    break;
                }
            }
        }, USERNAME);
        
        await page.evaluate(function() {
            var btn = document.querySelector('button[type="submit"]');
            if (btn) btn.click();
        });
        
        await new Promise(function(r) { setTimeout(r, 5000); });
        
        console.log('Entering password...');
        for (var i = 0; i < 15; i++) {
            var hasPassword = await page.evaluate(function() { return !!document.querySelector('input[type="password"]'); });
            if (hasPassword) break;
            await new Promise(function(r) { setTimeout(r, 2000); });
        }
        
        await page.evaluate(function(pwd) {
            var pwdInput = document.querySelector('input[type="password"]');
            if (pwdInput) {
                pwdInput.focus();
                pwdInput.value = pwd;
                pwdInput.dispatchEvent(new Event('input', { bubbles: true }));
                pwdInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }, PASSWORD);
        
        await page.evaluate(function() {
            var btn = document.querySelector('button[type="submit"]');
            if (btn) btn.click();
        });
        
        await new Promise(function(r) { setTimeout(r, 10000); });
        console.log('Login successful!');
        
        // RECENT DATA FIRST (5 Days - smaller, faster)
        console.log('=== Scraping 5 Days data ===');
        await page.goto('https://licensing.ansys.com/transactions', { waitUntil: 'networkidle0', timeout: 120000 });
        await waitForTableLoad(page);
        recentRows = await scrapeData(page, '5 Days', 'recent', downloadPath);
        
        // HISTORICAL DATA SECOND (1 Year - larger, takes longer)
        console.log('=== Scraping 1 Year data ===');
        await page.goto('https://licensing.ansys.com/transactions', { waitUntil: 'networkidle0', timeout: 120000 });
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
            return document.body.innerText.includes('Start Time');
        });
        if (hasContent) {
            console.log('Table headers found!');
            break;
        }
        await new Promise(function(r) { setTimeout(r, 2000); });
    }
    
    // Wait for actual row data
    for (var i = 0; i < 15; i++) {
        var rowCount = await page.evaluate(function() {
            return document.querySelectorAll('[role="row"]').length;
        });
        console.log('Row elements found: ' + rowCount);
        if (rowCount > 1) break;
        await new Promise(function(r) { setTimeout(r, 2000); });
    }
    
    console.log('Page loaded!');
}

async function scrapeData(page, dateOption, filePrefix, downloadPath) {
    // Take screenshot before clicking date picker
    await page.screenshot({ path: 'debug-before-datepicker-' + filePrefix + '.png' });
    
    // Check current page state
    var pageState = await page.evaluate(function() {
        var text = document.body.innerText;
        return {
            hasFrom: text.includes('From'),
            hasTo: text.includes('To'),
            hasStartTime: text.includes('Start Time'),
            rowCount: document.querySelectorAll('[role="row"]').length,
            pageInfo: text.match(/\d+\s+to\s+\d+\s+of\s+[\d,]+/i) ? text.match(/\d+\s+to\s+\d+\s+of\s+[\d,]+/i)[0] : 'not found'
        };
    });
    console.log('Page state: ' + JSON.stringify(pageState));
    
    // Click date picker
    var datePickerClicked = await page.evaluate(function() {
        var buttons = document.querySelectorAll('button');
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            if (btn.textContent && btn.textContent.includes('From') && btn.textContent.includes('To')) {
                btn.click();
                return 'clicked button with From/To';
            }
        }
        return 'no date picker button found';
    });
    console.log('Date picker: ' + datePickerClicked);
    await new Promise(function(r) { setTimeout(r, 2000); });
    
    // Take screenshot after clicking date picker
    await page.screenshot({ path: 'debug-after-datepicker-' + filePrefix + '.png' });
    
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
        return 'option not found: ' + option;
    }, dateOption);
    console.log('Date option: ' + optionClicked);
    
    // Wait for table to reload
    console.log('Waiting for table to reload...');
    await new Promise(function(r) { setTimeout(r, 3000); });
    
    // Wait for loading to finish
    for (var i = 0; i < 15; i++) {
        var loading = await page.evaluate(function() { return document.body.innerText.includes('Loading'); });
        if (!loading) break;
        console.log('Still loading...');
        await new Promise(function(r) { setTimeout(r, 1000); });
    }
    await new Promise(function(r) { setTimeout(r, 3000); });
    
    // Take screenshot after loading
    await page.screenshot({ path: 'debug-after-load-' + filePrefix + '.png' });
    
    // Get page info
    var pageInfo = await page.evaluate(function() {
        var text = document.body.innerText;
        var rowMatch = text.match(/(\d+)\s+to\s+(\d+)\s+of\s+([\d,]+)/i);
        var totalRows = rowMatch ? parseInt(rowMatch[3].replace(/,/g, '')) : 0;
        var pageMatch = text.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
        var totalPages = pageMatch ? parseInt(pageMatch[2]) : 1;
        var currentPage = pageMatch ? parseInt(pageMatch[1]) : 1;
        return { 
            totalPages: totalPages, 
            totalRows: totalRows,
            currentPage: currentPage,
            rowMatchText: rowMatch ? rowMatch[0] : 'not found',
            pageMatchText: pageMatch ? pageMatch[0] : 'not found'
        };
    });
    
    console.log('Page info: ' + JSON.stringify(pageInfo));
    
    var totalPages = pageInfo.totalPages;
    var totalRows = pageInfo.totalRows;
    
    console.log('Total pages: ' + totalPages + ', Total rows expected: ' + totalRows);
    
    var allData = [];
    var lastFirstCell = '';
    
    for (var pageNum = 1; pageNum <= totalPages; pageNum++) {
        if (pageNum % 20 === 1 || pageNum === totalPages) {
            console.log('Scraping page ' + pageNum + '/' + totalPages + '...');
        }
        
        // Get table data
        var pageData = await page.evaluate(function(numCols) {
            var rows = [];
            var rowElements = document.querySelectorAll('[role="row"]');
            
            for (var i = 0; i < rowElements.length; i++) {
                if (i === 0) continue;
                var row = rowElements[i];
                
                var cells = row.querySelectorAll('[role="cell"]');
                if (cells.length === 0) cells = row.querySelectorAll('[role="gridcell"]');
                if (cells.length === 0) cells = row.querySelectorAll('td');
                
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
        
        if (pageNum === 1) {
            console.log('First page data rows: ' + pageData.length);
            if (pageData.length > 0) {
                console.log('First row: ' + JSON.stringify(pageData[0]));
            }
        }
        
        // Check if data actually changed
        var currentFirstCell = pageData.length > 0 ? pageData[0][0] : '';
        if (pageNum > 1 && currentFirstCell === lastFirstCell) {
            console.log('  WARNING: Data did not change, waiting longer...');
            await new Promise(function(r) { setTimeout(r, 2000); });
            
            // Try getting data again
            pageData = await page.evaluate(function(numCols) {
                var rows = [];
                var rowElements = document.querySelectorAll('[role="row"]');
                
                for (var i = 0; i < rowElements.length; i++) {
                    if (i === 0) continue;
                    var row = rowElements[i];
                    
                    var cells = row.querySelectorAll('[role="cell"]');
                    if (cells.length === 0) cells = row.querySelectorAll('[role="gridcell"]');
                    if (cells.length === 0) cells = row.querySelectorAll('td');
                    
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
            currentFirstCell = pageData.length > 0 ? pageData[0][0] : '';
        }
        lastFirstCell = currentFirstCell;
        
        allData = allData.concat(pageData);
        
        // Go to next page
        if (pageNum < totalPages) {
            // Click the AG-Grid "Next Page" button
            await page.evaluate(function() {
                var nextBtn = document.querySelector('[aria-label="Next Page"]');
                if (nextBtn && !nextBtn.classList.contains('ag-disabled')) {
                    nextBtn.click();
                }
            });
            
            // Wait for page number to change
            var expectedPage = pageNum + 1;
            for (var waitAttempt = 0; waitAttempt < 10; waitAttempt++) {
                await new Promise(function(r) { setTimeout(r, 500); });
                var currentPageNum = await page.evaluate(function() {
                    var text = document.body.innerText;
                    var match = text.match(/Page\s+(\d+)\s+of/i);
                    return match ? parseInt(match[1]) : 0;
                });
                if (currentPageNum === expectedPage) {
                    break;
                }
            }
            
            // Additional wait for data to load
            await new Promise(function(r) { setTimeout(r, 1000); });
        }
    }
    
    console.log('Scraped ' + allData.length + ' rows total (expected ' + totalRows + ')');
    
    // Deduplicate
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
    
    // Convert to CSV
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
