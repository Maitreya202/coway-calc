// Cloudflare Pages Function: 모든 요청에 HTTP Basic 인증을 요구
// 올바른 아이디/비번이 없으면 실제 페이지 내용은 전혀 전송되지 않음

const USER = 'gallery';
const PASS = 'gallerycalc01';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.pathname.startsWith('/promo/')) {
    // 네이버 블로그 등 외부 유입용 고객 대상 견적 페이지 — 인증 없이 공개 접근 허용
    return context.next();
  }

  const auth = context.request.headers.get('Authorization');
  const expected = 'Basic ' + btoa(USER + ':' + PASS);

  if (auth !== expected) {
    return new Response('인증이 필요합니다.', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="coway-calc"' }
    });
  }

  return context.next();
}
