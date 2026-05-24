const https = require('https');

function test() {
  const data = new URLSearchParams({ bld: 'db/mdc/MDC/standard/MDCSTAT00101/data', idxIndMsclpCntnt: '01', trdDd: '20260514' }).toString();
  const options = {
    hostname: 'data.krx.co.kr',
    path: '/comm/bldAttendant/getJsonData.cmd',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Content-Length': data.length,
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Origin': 'http://data.krx.co.kr',
      'Referer': 'http://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201010101',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'X-Requested-With': 'XMLHttpRequest'
    }
  };
  const req = https.request(options, (res) => {
    let d = '';
    res.on('data', (chunk) => { d += chunk; });
    res.on('end', () => { 
        console.log(d.substring(0, 500)); 
        if(d.includes('output')) {
            console.log(JSON.parse(d).output[0]);
        }
    });
  });
  req.on('error', (e) => { console.error(e); });
  req.write(data);
  req.end();
}
test();
