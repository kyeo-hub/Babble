package com.babble.app.data

import android.database.sqlite.SQLiteDatabase
import android.util.Base64
import java.io.File
import kotlin.math.floor

/** 解析结果：导入负载 + 被跳过（外部存储）的资源数 */
data class ParsedImport(
    val payload: ImportPayload,
    val skippedResources: Int,
)

/**
 * 解析 memos.db（使用 Android 系统 SQLite，兼容不同 memos 版本）：
 * - 列探测（pinned/row_status/visibility/blob 等可能缺失）；
 * - 时间戳毫秒→秒归一化；
 * - 仅提取本地 blob 资源，外部存储资源跳过并计数。
 */
object MemosDbParser {

    fun parse(file: File): ParsedImport {
        val db = SQLiteDatabase.openDatabase(file.absolutePath, null, SQLiteDatabase.OPEN_READONLY)

        fun hasTable(name: String): Boolean =
            db.rawQuery("SELECT name FROM sqlite_master WHERE type='table' AND name=?", arrayOf(name))
                .use { it.moveToFirst() }

        fun columns(table: String): Set<String> =
            db.rawQuery("PRAGMA table_info($table)", null).use { c ->
                val set = mutableSetOf<String>()
                while (c.moveToNext()) set.add(c.getString(1))
                set
            }

        if (!hasTable("memo")) throw IllegalArgumentException("所选文件不是有效的 memos 数据库（缺少 memo 表）")
        val memoCols = columns("memo")
        val resCols = if (hasTable("resource")) columns("resource") else emptySet()

        // memos
        val memos = mutableListOf<ImportMemo>()
        val memoIdToIndex = HashMap<Long, Int>()
        db.rawQuery("SELECT * FROM memo ORDER BY id", null).use { c ->
            val idIdx = c.getColumnIndexOrThrow("id")
            val contentIdx = c.getColumnIndexOrThrow("content")
            val uidIdx = c.getColumnIndex("uid")
            val visIdx = if (memoCols.contains("visibility")) c.getColumnIndex("visibility") else -1
            val pinnedIdx = if (memoCols.contains("pinned")) c.getColumnIndex("pinned") else -1
            val statusIdx = if (memoCols.contains("row_status")) c.getColumnIndex("row_status") else -1
            val createdIdx = c.getColumnIndexOrThrow("created_ts")
            val updatedIdx = c.getColumnIndex("updated_ts")

            while (c.moveToNext()) {
                val id = c.getLong(idIdx)
                memoIdToIndex[id] = memos.size
                memos.add(
                    ImportMemo(
                        uid = if (uidIdx >= 0) c.getString(uidIdx) else null,
                        content = c.getString(contentIdx) ?: "",
                        visibility = if (visIdx >= 0) (c.getString(visIdx) ?: "private").lowercase() else "private",
                        pinned = if (pinnedIdx >= 0 && c.getInt(pinnedIdx) == 1) 1 else 0,
                        rowStatus = if (statusIdx >= 0) (c.getString(statusIdx) ?: "normal").lowercase() else "normal",
                        createdTs = normalizeTs(c.getLong(createdIdx)),
                        updatedTs = if (updatedIdx >= 0) normalizeTs(c.getLong(updatedIdx)) else null,
                    ),
                )
            }
        }

        // resources（仅本地 blob）
        val resources = mutableListOf<ImportResource>()
        var skipped = 0
        if (hasTable("resource") && resCols.contains("blob")) {
            db.rawQuery("SELECT * FROM resource", null).use { c ->
                val idIdx = c.getColumnIndexOrThrow("id")
                val memoIdx = c.getColumnIndex("memo_id")
                val uidIdx = c.getColumnIndex("uid")
                val nameIdx = if (resCols.contains("filename")) c.getColumnIndex("filename") else -1
                val typeIdx = c.getColumnIndex("type")
                val sizeIdx = c.getColumnIndex("size")
                val blobIdx = c.getColumnIndexOrThrow("blob")

                while (c.moveToNext()) {
                    val blob = c.getBlob(blobIdx)
                    if (blob == null || blob.isEmpty()) {
                        skipped++
                        continue
                    }
                    val memoId = if (memoIdx >= 0 && !c.isNull(memoIdx)) c.getLong(memoIdx) else null
                    resources.add(
                        ImportResource(
                            memoIndex = memoId?.let { memoIdToIndex[it] },
                            uid = if (uidIdx >= 0) c.getString(uidIdx) else null,
                            name = if (nameIdx >= 0) (c.getString(nameIdx) ?: "resource") else "resource",
                            type = if (typeIdx >= 0) (c.getString(typeIdx) ?: "application/octet-stream")
                            else "application/octet-stream",
                            size = if (sizeIdx >= 0) c.getLong(sizeIdx) else blob.size.toLong(),
                            dataBase64 = Base64.encodeToString(blob, Base64.NO_WRAP),
                        ),
                    )
                }
            }
        }
        db.close()

        return ParsedImport(
            payload = ImportPayload(
                batchId = "android-${System.currentTimeMillis()}",
                memos = memos,
                resources = resources,
            ),
            skippedResources = skipped,
        )
    }

    private fun normalizeTs(ts: Long): Long =
        if (ts > 1_000_000_000_000L) floor(ts / 1000.0).toLong() else ts
}
