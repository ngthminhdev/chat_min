package com.chatmin.app

import android.os.Bundle
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/** Reinstalled by android-build.sh after Tauri regenerates its Android project. */
class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
    }

    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        // Install after Tauri's own callback; navigation lives in the React store, not URL history.
        webView.post {
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
