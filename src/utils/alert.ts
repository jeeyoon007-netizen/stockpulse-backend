import axios from 'axios';

/**
 * 카카오톡으로 에러 알림을 전송합니다.
 * 
 * 주의: 카카오톡 메시지 API는 OAuth 2.0 액세스 토큰이 필요합니다.
 * 이 함수는 구조적 뼈대이며, 실제로 동작하려면 초기 토큰 발급 및 갱신 로직이 추가되어야 합니다.
 */
export async function sendKakaoAlert(message: string) {
  const restApiKey = process.env.KAKAO_REST_API_KEY;
  if (!restApiKey) {
    console.warn('KAKAO_REST_API_KEY가 설정되지 않았습니다.');
    return;
  }

  console.log(`[Kakao Alert (Mock)]: ${message}`);

  try {
    // 실제 구현 시에는 발급받은 Access Token을 사용해야 합니다.
    // POST https://kapi.kakao.com/v2/api/talk/memo/default/send
    // Header: Authorization: Bearer {ACCESS_TOKEN}
    
    /*
    await axios.post('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
      template_object: JSON.stringify({
        object_type: 'text',
        text: `🚨 [StockPulse Alert]\n${message}`,
        link: {
          web_url: 'http://localhost:3000',
          mobile_web_url: 'http://localhost:3000'
        },
        button_title: '바로가기'
      })
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.KAKAO_ACCESS_TOKEN}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    */
  } catch (err) {
    console.error('카카오톡 알림 전송 실패:', err);
  }
}
