package com.chatmin.app

import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

class FilesPluginTest {
    @Test fun namesCannotEscapeCacheAndRetainMediaExtension() {
        assertEquals("holiday.jpg", PickedFileCache.safeName("../../holiday.jpg", "png"))
        assertEquals("clip.mp4", PickedFileCache.safeName("C:\\Camera\\clip.mp4", "mp4"))
        assertEquals("Ảnh gia đình.jpg", PickedFileCache.safeName("Ảnh gia đình", "jpg"))
        assertEquals("attachment.jpg", PickedFileCache.safeName("..", "jpg"))
        assertEquals("photo.heic", PickedFileCache.safeName("photo.heic", "jpg"))
    }

    @Test fun copiesBytesWithDistinctPathsAndOriginalNames() {
        val dir = Files.createTempDirectory("chatmin-picked-test").toFile()
        try {
            val data = ByteArray(262144) { (it % 251).toByte() }
            val first = PickedFileCache.copy(ByteArrayInputStream(data), dir, "photo.jpg")
            val second = PickedFileCache.copy(ByteArrayInputStream(data), dir, "photo.jpg")
            assertArrayEquals(data, first.readBytes())
            assertArrayEquals(data, second.readBytes())
            assertEquals("photo.jpg", first.name)
            assertNotEquals(first.absolutePath, second.absolutePath)
        } finally { dir.deleteRecursively() }
    }

    @Test fun failedProviderStreamClosesAndRemovesPartialFile() {
        val dir = Files.createTempDirectory("chatmin-picked-failure").toFile()
        var closed = false
        val failing = object : InputStream() {
            var remaining = 128
            override fun read(): Int {
                if (remaining-- > 0) return 65
                throw java.io.IOException("provider disconnected")
            }
            override fun close() { closed = true }
        }
        try {
            assertThrows(java.io.IOException::class.java) { PickedFileCache.copy(failing, dir, "photo.jpg") }
            assertTrue(closed)
            assertEquals(0, dir.listFiles()!!.size)
        } finally { dir.deleteRecursively() }
    }
}
