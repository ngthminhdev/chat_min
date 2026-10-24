package com.chatmin.app

import android.app.Activity
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.util.concurrent.Executors
import org.json.JSONArray

@InvokeArg
class ImportUrisArgs {
    var paths: List<String> = emptyList()
}

/** Android's system picker grants access to content URIs, which Rust cannot stat/open. */
@TauriPlugin
class FilesPlugin(private val activity: Activity) : Plugin(activity) {
    private val worker = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "chatmin-picked-files").apply { isDaemon = true }
    }

    @Command
    fun importUris(invoke: Invoke) {
        val paths = invoke.parseArgs(ImportUrisArgs::class.java).paths
        worker.execute {
            val copied = mutableListOf<File>()
            try {
                val resolver = activity.contentResolver
                val imported = paths.map { path ->
                    if (!path.startsWith("content://")) path else {
                        val uri = Uri.parse(path)
                        val displayName = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                            val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                            if (column >= 0 && cursor.moveToFirst()) cursor.getString(column) else null
                        }
                        val extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(resolver.getType(uri))
                        val name = PickedFileCache.safeName(displayName, extension)
                        val stream = resolver.openInputStream(uri) ?: error("Không mở được tệp đã chọn")
                        val file = PickedFileCache.copy(stream, File(activity.cacheDir, "outbox"), name)
                        copied.add(file)
                        file.absolutePath
                    }
                }
                activity.runOnUiThread { invoke.resolve(JSObject().put("paths", JSONArray(imported))) }
            } catch (error: Exception) {
                copied.forEach { it.parentFile?.deleteRecursively() }
                activity.runOnUiThread {
                    invoke.reject("Không đọc được ảnh/tệp đã chọn. Hãy chọn lại hoặc tải tệp về máy trước. ${error.localizedMessage.orEmpty()}", "file_import_failed")
                }
            }
        }
    }

    override fun onDestroy(activity: AppCompatActivity) { worker.shutdown() }
}
