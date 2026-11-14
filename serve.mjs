import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('./dist/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
    '.css':'text/css; charset=utf-8','.wasm':'application/wasm','.jpg':'image/jpeg'};
const port=Number(process.env.PORT||4173);
createServer(async (request,response)=>{
    try {
        const path=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
        const file=resolve(root,'.'+(path==='/'?'/index.html':path));
        if(!file.startsWith(resolve(root)+sep) || !(await stat(file)).isFile()) {
            response.writeHead(404).end();
            return;
        }
        response.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});
        createReadStream(file).pipe(response);
    } catch {
        response.writeHead(404).end();
    }
}).on('error',error=>{
    console.error(error.code==='EADDRINUSE'
        ? `Port ${port} is already in use. To choose another port, run PORT=4174 node serve.mjs.`
        : error.message);
    process.exitCode=1;
}).listen(port,'127.0.0.1',()=>{
    const url=`http://127.0.0.1:${port}/`;
    console.log(`Fjord Stone is available at ${url}`);
    if(process.argv.includes('--open') && process.platform==='darwin') {
        execFile('open',[url],error=>{if(error) console.error(`Open ${url} in your browser.`);});
    }
});
