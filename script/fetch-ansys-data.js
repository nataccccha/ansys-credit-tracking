const CryptoJS = require('crypto-js');
const fs = require('fs');

const password = process.argv[2] || 'changeme123';
const inputFile = process.argv[3] || 'ansys_trend_dashboard.html';
const outputFile = process.argv[4] || 'ansys_trend_dashboard_protected.html';

// Read the original HTML
const originalHTML = fs.readFileSync(inputFile, 'utf8');

// Encrypt the content
const encrypted = CryptoJS.AES.encrypt(originalHTML, password).toString();

// Create the password-protected HTML wrapper
const protectedHTML = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ANSYS AEC Dashboard - Login</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
            background: linear-gradient(135deg, #005B7F 0%, #007aff 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .login-container {
            background: white;
            padding: 40px;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center;
            max-width: 400px;
            width: 90%;
        }
        .logo { font-size: 1.5rem; font-weight: 700; color: #005B7F; margin-bottom: 8px; }
        .subtitle { color: #666; margin-bottom: 30px; font-size: 0.9rem; }
        input[type="password"] {
            width: 100%;
            padding: 14px 18px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 1rem;
            margin-bottom: 20px;
            transition: border-color 0.2s;
        }
        input[type="password"]:focus { outline: none; border-color: #005B7F; }
        button {
            width: 100%;
            padding: 14px;
            background: linear-gradient(135deg, #005B7F, #007aff);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        button:hover { transform: translateY(-2px); box-shadow: 0 4px 20px rgba(0,91,127,0.4); }
        .error { color: #ff3b30; margin-top: 15px; display: none; }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="logo">ANSYS AEC Dashboard</div>
        <div class="subtitle">Enter password to access</div>
        <input type="password" id="password" placeholder="Password" onkeypress="if(event.key==='Enter')decrypt()">
        <button onclick="decrypt()">Unlock Dashboard</button>
        <div class="error" id="error">Incorrect password</div>
    </div>
    <script>
        const encryptedData = "${encrypted}";
        function decrypt() {
            const password = document.getElementById('password').value;
            try {
                const decrypted = CryptoJS.AES.decrypt(encryptedData, password);
                const html = decrypted.toString(CryptoJS.enc.Utf8);
                if (html && html.includes('<!DOCTYPE html>')) {
                    document.open();
                    document.write(html);
                    document.close();
                } else {
                    document.getElementById('error').style.display = 'block';
                }
            } catch (e) {
                document.getElementById('error').style.display = 'block';
            }
        }
    </script>
</body>
</html>`;

fs.writeFileSync(outputFile, protectedHTML);
console.log(\`Encrypted \${inputFile} -> \${outputFile}\`);
console.log(\`Password: \${password}\`);
console.log('\\nTo use a different password, run:');
console.log(\`  node encrypt.js "your-password" \${inputFile} \${outputFile}\`);
