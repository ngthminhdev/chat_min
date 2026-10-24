package com.chatmin.app

import android.graphics.Bitmap
import android.os.Bundle
import android.view.WindowManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewCompat
import java.io.InputStream

/** Reinstalled by android-build.sh after Tauri regenerates its Android project. */
class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
    }

    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        // Pinch belongs to the photo viewer. WebView ignores the viewport meta's user-scalable
        // (useWideViewPort is off), so page zoom must be disabled here or the whole UI magnifies.
        webView.settings.setSupportZoom(false)
        // Install after Tauri's own callback; navigation lives in the React store, not URL history.
        webView.post {
            webView.webViewClient = RangeFixClient(WebViewCompat.getWebViewClient(webView))
            onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
                private var pending = false
                override fun handleOnBackPressed() {
                    if (ViewCompat.getRootWindowInsets(webView)?.isVisible(WindowInsetsCompat.Type.ime()) == true) {
                        WindowInsetsControllerCompat(window, webView).hide(WindowInsetsCompat.Type.ime())
                        return
                    }
                    if (pending) return
                    pending = true
                    webView.evaluateJavascript("window.__chatminBack ? window.__chatminBack() : false") { consumed ->
                        pending = false
                        if (consumed == "false") moveTaskToBack(true)
                    }
                }
            })
        }
    }
}

/** WebView answers a Range request by skip()ping the returned stream to the range start, as if
 * it were the whole file. The asset protocol and tgstream already return only that range (206),
 * so ranges past the first chunk failed (mp4s with moov at the end never loaded) or read the
 * wrong bytes. Prefix the 206 body with a virtual gap of `start` bytes for WebView to skip.
 * ponytail: delegates only what wry's RustWebViewClient overrides; recheck on wry upgrades. */
private class RangeFixClient(private val inner: WebViewClient) : WebViewClient() {
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val response = inner.shouldInterceptRequest(view, request) ?: return null
        if (response.statusCode != 206) return response
        val range = response.responseHeaders?.entries?.firstOrNull { it.key.equals("Content-Range", true) }?.value
        val start = range?.let { Regex("""bytes (\d+)-""").find(it)?.groupValues?.get(1)?.toLongOrNull() } ?: return response
        if (start > 0) response.data = Gap(start, response.data)
        return response
    }
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = inner.shouldOverrideUrlLoading(view, request)
    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) = inner.onPageStarted(view, url, favicon)
    override fun onPageFinished(view: WebView, url: String) = inner.onPageFinished(view, url)
    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) = inner.onReceivedError(view, request, error)
}

private class Gap(private var gap: Long, private val body: InputStream) : InputStream() {
    override fun skip(n: Long): Long {
        if (gap == 0L) return body.skip(n)
        val k = minOf(n, gap); gap -= k; return k
    }
    override fun available() = (gap + body.available()).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
    override fun read() = if (gap > 0) { gap--; 0 } else body.read()
    override fun read(b: ByteArray, off: Int, len: Int): Int {
        if (gap == 0L) return body.read(b, off, len)
        val k = minOf(len.toLong(), gap).toInt(); b.fill(0, off, off + k); gap -= k; return k
    }
    override fun close() = body.close()
}
