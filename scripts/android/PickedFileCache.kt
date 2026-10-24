package com.chatmin.app

import java.io.File
import java.io.InputStream
import java.util.UUID

/** Stream provider data into a private outbox; no whole-file byte array crosses IPC. */
internal object PickedFileCache {
    fun safeName(displayName: String?, extension: String?): String {
        val basename = displayName.orEmpty().substringAfterLast('/').substringAfterLast('\\')
        var name = basename.replace(Regex("[\\p{Cntrl}:*?\"<>|]"), "_")
            .trim().trimEnd('.', ' ').ifBlank { "attachment" }
        val ext = extension?.takeIf { it.matches(Regex("[A-Za-z0-9]{1,12}")) }
        if (!name.contains('.') && ext != null) name += ".$ext"
        if (name.length > 180) {
            val suffix = name.substringAfterLast('.', "").takeIf { it.length in 1..12 }?.let { ".$it" }.orEmpty()
            name = name.take(180 - suffix.length) + suffix
        }
        return name
    }

    fun copy(input: InputStream, cacheDir: File, name: String): File {
        val directory = File(cacheDir, "picked-${UUID.randomUUID()}")
        try {
            input.use { source ->
                check(directory.mkdirs()) { "Không tạo được bộ nhớ tạm" }
                val destination = File(directory, name)
                destination.outputStream().use { output -> source.copyTo(output, 64 * 1024) }
                return destination
            }
        } catch (error: Exception) {
            directory.deleteRecursively()
            throw error
        }
    }
}
