# WebView JavascriptInterface 메서드는 난독화 대상에서 제외해야 JS에서 호출 가능
-keepclassmembers class com.cowaygallery.calc.AndroidFileBridge {
    public *;
}
