package com.cowaygallery.calc

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.HttpAuthHandler
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ProgressBar
import androidx.appcompat.app.AppCompatActivity
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var progressBar: ProgressBar

    companion object {
        // 견적계산기 배포 주소 (Cloudflare Pages)
        private const val SITE_URL = "https://coway-calc.pages.dev/"

        // functions/_middleware.js 의 Basic 인증 계정과 반드시 일치시킬 것
        private const val AUTH_USER = "gallery"
        private const val AUTH_PASS = "gallerycalc01"

        // blob:/data: 다운로드를 가로채 AndroidBridge.saveBase64File로 넘기는 훅.
        // index.html 쪽 코드는 건드리지 않고, 페이지 로드 후 주입만 한다.
        private const val BLOB_DOWNLOAD_HOOK_JS = """
            (function(){
              if (window.__abridgeInstalled) return;
              window.__abridgeInstalled = true;

              function handleDownload(a){
                if (!a || !a.href || !a.hasAttribute || !a.hasAttribute('download')) return false;
                var href = a.href;
                var filename = a.getAttribute('download') || 'download';
                if (href.indexOf('data:') === 0) {
                  var mime = (href.match(/^data:([^;,]+)/) || [null,'application/octet-stream'])[1];
                  if (window.AndroidBridge && window.AndroidBridge.saveBase64File) {
                    window.AndroidBridge.saveBase64File(href, filename, mime);
                  }
                  return true;
                }
                if (href.indexOf('blob:') === 0) {
                  fetch(href).then(function(r){ return r.blob(); }).then(function(blob){
                    var reader = new FileReader();
                    reader.onloadend = function(){
                      var mime = blob.type || 'application/octet-stream';
                      if (window.AndroidBridge && window.AndroidBridge.saveBase64File) {
                        window.AndroidBridge.saveBase64File(reader.result, filename, mime);
                      }
                    };
                    reader.readAsDataURL(blob);
                  });
                  return true;
                }
                return false;
              }

              // jsPDF/FileSaver 등은 문서에 붙지 않은(detached) <a>를 click()하는 경우가 많아
              // document 이벤트 리스너로는 못 잡는다 — click() 메서드 자체를 가로챈다.
              var origClick = HTMLAnchorElement.prototype.click;
              HTMLAnchorElement.prototype.click = function(){
                if (handleDownload(this)) return;
                return origClick.apply(this, arguments);
              };

              // dispatchEvent(new MouseEvent('click'))로 클릭을 흉내내는 구현 대비
              var origDispatch = HTMLAnchorElement.prototype.dispatchEvent;
              HTMLAnchorElement.prototype.dispatchEvent = function(evt){
                if (evt && evt.type === 'click' && handleDownload(this)) return true;
                return origDispatch.call(this, evt);
              };

              // 사용자가 직접 다운로드 링크를 탭하는 경우(문서에 붙어있는 케이스) 대비 보조 리스너
              document.addEventListener('click', function(e){
                var a = e.target;
                while (a && a.tagName !== 'A') a = a.parentElement;
                if (a && handleDownload(a)) { e.preventDefault(); e.stopPropagation(); }
              }, true);
            })();
        """
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        swipeRefresh = findViewById(R.id.swipeRefresh)
        progressBar = findViewById(R.id.progressBar)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = false
        }

        webView.addJavascriptInterface(AndroidFileBridge(this), "AndroidBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedHttpAuthRequest(
                view: WebView?,
                handler: HttpAuthHandler?,
                host: String?,
                realm: String?
            ) {
                // functions/_middleware.js 의 Basic 인증에 자동 응답 (내부 직원 전용 앱이라 가정)
                handler?.proceed(AUTH_USER, AUTH_PASS)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                swipeRefresh.isRefreshing = false
                view?.evaluateJavascript(BLOB_DOWNLOAD_HOOK_JS, null)
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progressBar.progress = newProgress
                progressBar.visibility = if (newProgress in 1..99) android.view.View.VISIBLE else android.view.View.GONE
            }
        }

        swipeRefresh.setOnRefreshListener { webView.reload() }

        webView.loadUrl(SITE_URL)
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
