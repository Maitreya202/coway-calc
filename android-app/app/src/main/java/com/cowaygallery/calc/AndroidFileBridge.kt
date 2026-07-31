package com.cowaygallery.calc

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.widget.Toast

/**
 * 웹 페이지의 blob/data URL 다운로드(jsPDF doc.save(), 이미지 저장 등)를
 * 순수 WebView는 자체적으로 처리하지 못하므로, JS 쪽에서 base64로 변환해
 * 넘겨주면 여기서 실제 파일로 저장한다. index.html 쪽 코드는 수정할 필요 없음
 * — MainActivity가 페이지 로드 후 주입하는 JS 훅이 다운로드 클릭을 가로챈다.
 */
class AndroidFileBridge(private val context: Context) {

    private val mainHandler = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun saveBase64File(dataUrlOrBase64: String, filename: String, mimeType: String) {
        try {
            val base64Part = if (dataUrlOrBase64.contains(",")) {
                dataUrlOrBase64.substringAfter(",")
            } else {
                dataUrlOrBase64
            }
            val bytes = Base64.decode(base64Part, Base64.DEFAULT)

            val resolver = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
                put(MediaStore.MediaColumns.MIME_TYPE, mimeType.ifBlank { "application/octet-stream" })
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/coway-calc")
                }
            }

            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            if (uri == null) {
                showToast("저장 실패: 저장소 접근 불가")
                return
            }
            resolver.openOutputStream(uri)?.use { out -> out.write(bytes) }
            showToast("다운로드 폴더에 저장됨: $filename")
        } catch (e: Exception) {
            e.printStackTrace()
            showToast("저장 실패: ${e.message}")
        }
    }

    private fun showToast(msg: String) {
        mainHandler.post { Toast.makeText(context, msg, Toast.LENGTH_LONG).show() }
    }
}
