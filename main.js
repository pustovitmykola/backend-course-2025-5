const { Command } = require('commander');
const http = require('http');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const superagent = require('superagent');

const program = new Command();

program
  .requiredOption('-h, --host <host>', 'server host')
  .requiredOption('-p, --port <port>', 'server port')
  .requiredOption('-c, --cache <path>', 'cache directory path');

program.configureOutput({
    outputError: (e) => {
        if (e.includes('--host')) {
            console.error('Please, specify server host');
        } else if (e.includes('--port')) {
            console.error('Please, specify server port');
        } else if (e.includes('--cache')) {
            console.error('Please, specify cache directory');
        } else {
            console.error(e);
        }
    }
});

program.parse(process.argv);
const options = program.opts();

// Створення директорії кешу, якщо не існує
const cachePath = path.resolve(options.cache);
if (!fsSync.existsSync(cachePath)) {
    fsSync.mkdirSync(cachePath, { recursive: true });
    console.log(`Cache directory created: ${cachePath}`);
}

// Функція для отримання шляху до файлу кешу
function getCacheFilePath(code) {
    return path.join(cachePath, `${code}.jpg`);
}

// Функція для отримання картинки з http.cat
async function fetchFromHttpCat(code) {
    try {
        const response = await superagent
            .get(`https://http.cat/${code}`)
            .responseType('blob')
            .buffer(true);

        if (!response.body || response.body.length === 0) {
            throw new Error('Empty response from http.cat');
        }

        return response.body;
    } catch (error) {
        console.error(`Error fetching from http.cat: ${error.message}`);
        throw new Error('Image not found on http.cat');
    }
}

// HTTP сервер
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const code = url.pathname.slice(1); // Отримуємо код без початкового '/'

    if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad Request: HTTP status code required');
        return;
    }

    try {
        const cacheFile = getCacheFilePath(code);

        // GET - отримати картинку з кешу
        if (req.method === 'GET') {
            try {
                // Спроба прочитати з кешу
                const imageData = await fs.readFile(cacheFile);

                if (imageData.length === 0) {
                    throw new Error('Empty cache file');
                }

                res.writeHead(200, {
                    'Content-Type': 'image/jpeg',
                    'Content-Length': imageData.length
                });
                res.end(imageData);
                console.log(`GET ${code}: Served from cache (${imageData.length} bytes)`);
            } catch (error) {
                // Якщо файлу немає в кеші, запитуємо з http.cat
                try {
                    console.log(`GET ${code}: Not in cache, fetching from http.cat...`);
                    const imageData = await fetchFromHttpCat(code);

                    // Зберігаємо в кеш
                    await fs.writeFile(cacheFile, imageData);
                    console.log(`GET ${code}: Saved to cache (${imageData.length} bytes)`);

                    // Відправляємо клієнту
                    res.writeHead(200, {
                        'Content-Type': 'image/jpeg',
                        'Content-Length': imageData.length
                    });
                    res.end(imageData);
                } catch (fetchError) {
                    res.writeHead(404, { 'Content-Type': 'text/plain' });
                    res.end('Not Found');
                    console.log(`GET ${code}: Not found - ${fetchError.message}`);
                }
            }
        }
        // PUT - записати картинку у кеш
        else if (req.method === 'PUT') {
            const chunks = [];

            req.on('data', chunk => {
                chunks.push(chunk);
            });

            req.on('end', async () => {
                try {
                    const imageData = Buffer.concat(chunks);
                    await fs.writeFile(cacheFile, imageData);
                    res.writeHead(201, { 'Content-Type': 'text/plain' });
                    res.end('Created');
                    console.log(`PUT ${code}: Saved to cache`);
                } catch (error) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Internal Server Error');
                    console.error(`PUT ${code}: Error - ${error.message}`);
                }
            });
        }
        // DELETE - видалити картинку з кешу
        else if (req.method === 'DELETE') {
            try {
                await fs.unlink(cacheFile);
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('OK');
                console.log(`DELETE ${code}: Removed from cache`);
            } catch (error) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
                console.log(`DELETE ${code}: Not found in cache`);
            }
        }
        // Інші методи не підтримуються
        else {
            res.writeHead(405, { 'Content-Type': 'text/plain' });
            res.end('Method Not Allowed');
            console.log(`${req.method} ${code}: Method not allowed`);
        }
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
        console.error(`Error: ${error.message}`);
    }
});

server.listen(parseInt(options.port), options.host, () => {
    console.log(`Proxy server running at http://${options.host}:${options.port}/`);
    console.log(`Cache directory: ${cachePath}`);
});