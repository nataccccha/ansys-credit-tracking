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
    
    await page.evaluateOnNewDocument(function() {
        Object.defineProperty(navigator, 'webdriver', { get: function() { return false; } });
    });
    
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
        
        console.log('=== Scraping 1 Year data ===');
        await page.goto('https://licensing.ansys.com/transactions', { waitUntil: 'networkidle0', timeout: 120000 });
        await waitForTableLoad(page);
        await scrapeData(page, '1 Year', 'historical', downloadPath);
        
        console.log('=== Scraping 5 Days data ===');
        await page.goto('https://licensing.ansys.com/transactions', { waitUntil: 'networkidle0', timeout: 120000 });
        await waitForTableLoad(page);
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

async function waitForTableLoad(page) {
    for (var i = 0; i < 30; i++) {
        var hasContent = await page.evaluate(function() {
            return document.body.innerText.includes('Start Time');
        });
        if (hasContent) break;
        await new Promise(function(r) { setTimeout(r, 2000); });
    }
    console.log('Page loaded!');
}

async function scrapeData(page, dateOption, filePrefix, downloadPath) {
    await page.evaluate(function() {
        var buttons = document.querySelectorAll('button');
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            if (btn.textContent && btn.textContent.includes('From') && btn.textContent.includes('To')) {
                btn.click();
                return;
            }
        }
    });
    await new Promise(function(r) { setTimeout(r, 2000); });
    
    await page.evaluate(function(option) {
        var elements = document.querySelectorAll('*');
        for (var i = 0; i < elements.length; i++) {
            var el = elements[i];
            if (el.textContent && el.textContent.trim() === option && el.children.length === 0) {
                el.click();
                return;
            }
        }
    }, dateOption);
    console.log('Selected ' + dateOption);
    
    await new Promise(function(r) { setTimeout(r, 3000); });
    for (var i = 0; i < 10; i++) {
        var loading = await page.evaluate(function() { return document.body.innerText.includes('Loading'); });
        if (!loading) break;
        await new Promise(function(r) { setTimeout(r, 1000); });
    }
    await new Promise(function(r) { setTimeout(r, 2000); });
    
    var pageInfo = await page.evaluate(function() {
        var text = document.body.innerText;
        var rowMatch = text.match(/\d+\s+to\s+\d+\s+of\s+([\d,]+)/i);
        var totalRows = rowMatch ? parseInt(rowMatch[1].replace(/,/g, '')) : 0;
        var pageMatch = text.match(/Page\s+\d+\s+of\s+(\d+)/i);
        var totalPages = pageMatch ? parseInt(pageMatch[1]) : 1;
        return { totalPages: totalPages, totalRows: totalRows };
    });
    
    var totalPages = pageInfo.totalPages;
    var totalRows = pageInfo.totalRows;
    
    console.log('Total pages: ' + totalPages + ', Total rows expected: ' + totalRows);
    
    // DEBUG: Log ALL buttons
    console.log('========== DEBUG: ALL 6 BUTTONS ==========');
    var allButtonsInfo = await page.evaluate(function() {
        var buttons = document.querySelectorAll('button');
        var result = [];
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            var rect = btn.getBoundingClientRect();
            result.push({
                i: i,
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                w: Math.round(rect.width),
                h: Math.round(rect.height),
                disabled: btn.disabled,
                aria: btn.getAttribute('aria-label'),
                title: btn.getAttribute('title'),
                text: (btn.innerText || '').substring(0, 30).replace(/\n/g, ' ').trim(),
                hasSvg: btn.querySelector('svg') !== null
            });
        }
        return result;
    });
    
    for (var i = 0; i < allButtonsInfo.length; i++) {
        var b = allButtonsInfo[i];
        console.log('  [' + b.i + '] pos:(' + b.x + ',' + b.y + ') size:' + b.w + 'x' + b.h + ' aria:"' + b.aria + '" title:"' + b.title + '" text:"' + b.text + '" svg:' + b.hasSvg + ' disabled:' + b.disabled);
    }
    
    // Also check for other clickable elements (divs, spans, a tags with role=button or pagination-related)
    console.log('========== DEBUG: OTHER CLICKABLE ELEMENTS ==========');
    var otherClickables = await page.evaluate(function() {
        var result = [];
        // Check for elements with role="button"
        var roleButtons = document.querySelectorAll('[role="button"]');
        for (var i = 0; i < roleButtons.length; i++) {
            var el = roleButtons[i];
            var rect = el.getBoundingClientRect();
            if (rect.y > 400) { // Lower part of page
                result.push({
                    tag: el.tagName,
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    w: Math.round(rect.width),
                    h: Math.round(rect.height),
                    aria: el.getAttribute('aria-label'),
                    text: (el.innerText || '').substring(0, 20).trim(),
                    classes: (el.className || '').substring(0, 50)
                });
            }
        }
        // Check for <a> tags in pagination area
        var links = document.querySelectorAll('a');
        for (var i = 0; i < links.length; i++) {
            var el = links[i];
            var rect = el.getBoundingClientRect();
            if (rect.y > 400 && rect.width < 100) { // Small links in lower part
                result.push({
                    tag: 'A',
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    w: Math.round(rect.width),
                    h: Math.round(rect.height),
                    aria: el.getAttribute('aria-label'),
                    text: (el.innerText || '').substring(0, 20).trim(),
                    href: (el.href || '').substring(0, 30)
                });
            }
        }
        // Check for anything with "page" or "next" in class/id
        var pageElements = document.querySelectorAll('[class*="page"], [class*="Page"], [class*="pagination"], [class*="Pagination"], [id*="page"], [id*="Page"]');
        for (var i = 0; i < pageElements.length; i++) {
            var el = pageElements[i];
            var rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                result.push({
                    tag: el.tagName,
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    w: Math.round(rect.width),
                    h: Math.round(rect.height),
                    classes: (el.className || '').substring(0, 80),
                    id: el.id || ''
                });
            }
        }
        return result;
    });
    
    for (var i = 0; i < otherClickables.length; i++) {
        var el = otherClickables[i];
        console.log('  ' + el.tag + ' pos:(' + el.x + ',' + el.y + ') size:' + el.w + 'x' + el.h + ' aria:"' + (el.aria || '') + '" text:"' + (el.text || '') + '" class:"' + (el.classes || '') + '"');
    }
    console.log('========== END DEBUG ==========');
    
    var allData = [];
    
    for (var pageNum = 1; pageNum <= totalPages; pageNum++) {
        console.log('Scraping page ' + pageNum + '/' + totalPages + '...');
        
        await new Promise(function(r) { setTimeout(r, 1500); });
        
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
        
        console.log('  Got ' + pageData.length + ' rows');
        allData = allData.concat(pageData);
        
        if (pageNum < totalPages) {
            // Try clicking the 3rd button (index 2) - should be "next" in |< < > >| layout
            var clicked = await page.evaluate(function() {
                var buttons = document.querySelectorAll('button');
                // Most pagination has 4-6 buttons: first, prev, next, last (and maybe page numbers)
                // The "next" button is usually the 3rd one
                if (buttons.length >= 4) {
                    var nextBtn = buttons[2]; // Try index 2
                    if (!nextBtn.disabled) {
                        nextBtn.click();
                        return 'clicked button index 2';
                    }
                }
                if (buttons.length >= 3) {
                    var nextBtn = buttons[buttons.length - 2]; // Second to last
                    if (!nextBtn.disabled) {
                        nextBtn.click();
                        return 'clicked second to last button';
                    }
                }
                return 'no click';
            });
            
            console.log('  ' + clicked);
            await new Promise(function(r) { setTimeout(r, 2500); });
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
