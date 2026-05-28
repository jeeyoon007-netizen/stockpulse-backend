import axios from 'axios';
async function run() {
  const res = await axios.get("https://finance.naver.com/sise/sise_index.naver?code=KOSPI", { responseType: 'arraybuffer' });
  const html = new TextDecoder('euc-kr').decode(res.data);
  const idx = html.indexOf('시가총액');
  if(idx > -1) {
    console.log(html.substring(idx - 50, idx + 200));
  } else {
    console.log("NOT FOUND");
  }
}
run();
