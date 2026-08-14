@file:OptIn(ExperimentalMaterial3Api::class)

package com.babble.app.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.babble.app.App
import com.babble.app.data.BackfillReport
import com.babble.app.data.ImportReport
import com.babble.app.data.MemosDbParser
import com.babble.app.data.ParsedImport
import com.babble.app.data.SkippedResource
import com.babble.app.data.UpdateMemoRequest
import com.babble.app.data.friendlyMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.concurrent.TimeUnit

/** 迁移页：选择 memos.db → 解析 → 导入；外部存储资源从旧站 API 补迁 */
@Composable
fun MigrateScreen(onBack: () -> Unit) {
    var parsed by remember { mutableStateOf<ParsedImport?>(null) }
    var parsing by remember { mutableStateOf(false) }
    var importing by remember { mutableStateOf(false) }
    var report by remember { mutableStateOf<ImportReport?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    // 补迁外部资源
    var oldBase by remember { mutableStateOf("") }
    var oldToken by remember { mutableStateOf("") }
    var backfilling by remember { mutableStateOf(false) }
    var backfillProgress by remember { mutableStateOf<String?>(null) }
    var backfillReport by remember { mutableStateOf<BackfillReport?>(null) }
    var backfillError by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val oldClient = remember {
        OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build()
    }

    fun runBackfill() {
        val p = parsed ?: return
        val base = oldBase.trim().trimEnd('/')
        val token = oldToken.trim()
        if (base.isEmpty() || token.isEmpty()) {
            backfillError = "请填写旧站地址与 token"
            return
        }
        backfilling = true
        backfillError = null
        backfillReport = null
        scope.launch(Dispatchers.IO) {
            try {
                // 1. 新站 memo uid → id（全量分页）
                val newMemoIdByUid = HashMap<String, Long>()
                var page = 1
                while (true) {
                    val resp = App.api.api.listMemos(page = page, pageSize = 100)
                    for (m in resp.items) newMemoIdByUid[m.uid] = m.id
                    if (resp.items.size < resp.pageSize || newMemoIdByUid.size >= resp.total) break
                    page++
                }
                var succeeded = 0
                var skipped = 0
                var failed = 0
                val total = p.skippedResourceList.size
                for ((idx, r) in p.skippedResourceList.withIndex()) {
                    backfillProgress = "补迁中…（${idx + 1}/$total）"
                    try {
                        val oldUid = r.srcMemoId?.let { p.memoUidMap[it] }
                        val newMemoId = oldUid?.let { newMemoIdByUid[it] }
                        if (newMemoId == null) {
                            skipped++
                            continue
                        }
                        // 2. 从旧站下载（多端点尝试，带旧站 Bearer）
                        val bytes = downloadFromOld(oldClient, base, token, r)
                        if (bytes == null || bytes.isEmpty()) {
                            failed++
                            continue
                        }
                        // 3. 上传新站（multipart：file + memoId）
                        val filePart = MultipartBody.Part.createFormData(
                            "file",
                            r.name,
                            bytes.toRequestBody(r.type.ifBlank { "application/octet-stream" }.toMediaType()),
                        )
                        val memoPart = MultipartBody.Part.createFormData("memoId", newMemoId.toString())
                        val uploaded = App.api.api.uploadResource(filePart, memoPart)
                        // 4. 重写 memo 内容里的旧引用 → 新资源路径
                        val memo = App.api.api.getMemo(newMemoId)
                        val newContent = rewriteContent(memo.content, base, r.uid.orEmpty(), uploaded.url)
                        if (newContent != memo.content) {
                            App.api.api.updateMemo(newMemoId, UpdateMemoRequest(content = newContent))
                        }
                        succeeded++
                    } catch (e: Exception) {
                        // 单个资源失败不中断整个补迁
                        failed++
                        backfillError = "资源 #${r.srcId}（${r.name}）失败：${e.friendlyMessage()}"
                    }
                }
                backfillProgress = null
                backfillReport = BackfillReport(total, succeeded, skipped, failed)
            } catch (e: Exception) {
                backfillError = "补迁失败：${e.friendlyMessage()}"
            } finally {
                backfilling = false
            }
        }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        parsing = true
        error = null
        scope.launch(Dispatchers.IO) {
            try {
                // 复制到 cacheDir 后用系统 SQLite 打开
                val tmp = File(context.cacheDir, "import_memos.db")
                context.contentResolver.openInputStream(uri)?.use { input ->
                    tmp.outputStream().use { output -> input.copyTo(output) }
                } ?: throw IllegalStateException("无法读取所选文件")
                parsed = MemosDbParser.parse(tmp)
            } catch (e: Exception) {
                error = "解析失败：${e.message}"
            } finally {
                parsing = false
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("迁移 memos 数据") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
            Text("从旧 memos 数据库（memos.db）导入", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(4.dp))
            Text(
                "选择你的 memos.db 文件，应用会读取 memo 内容与本地图片资源并导入到 Babble。",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = { picker.launch(arrayOf("application/x-sqlite3", "application/octet-stream", "*/*")) },
                enabled = !parsing && !importing && !backfilling,
            ) {
                Text("选择 memos.db 文件")
            }
            if (parsing) {
                Spacer(Modifier.height(12.dp))
                CircularProgressIndicator()
            }
            parsed?.let { p ->
                Spacer(Modifier.height(12.dp))
                Text(
                    "解析完成：${p.payload.memos.size} 条 memo，${p.payload.resources.size} 个资源" +
                        (if (p.skippedResources > 0) "（跳过 ${p.skippedResources} 个外部存储资源）" else ""),
                )
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = {
                        importing = true
                        error = null
                        scope.launch {
                            try {
                                report = App.api.api.importMemos(p.payload)
                            } catch (e: Exception) {
                                error = e.friendlyMessage()
                            } finally {
                                importing = false
                            }
                        }
                    },
                    enabled = !importing,
                ) {
                    Text(if (importing) "导入中…" else "开始导入")
                }

                // 补迁外部资源
                if (p.skippedResourceList.isNotEmpty()) {
                    HorizontalDivider(Modifier.padding(vertical = 12.dp))
                    Text("补迁外部资源（${p.skippedResourceList.size} 个）", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "这些资源没有本地 blob，将从旧站 API 下载并导入到 Babble（自动重写 memo 里的图片引用）。",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = oldBase,
                        onValueChange = { oldBase = it },
                        label = { Text("旧站地址（如 https://memos.kyeo.top）") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = oldToken,
                        onValueChange = { oldToken = it },
                        label = { Text("旧站 token（memos 设置 → API）") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(8.dp))
                    Button(
                        onClick = { runBackfill() },
                        enabled = !backfilling,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(if (backfilling) (backfillProgress ?: "补迁中…") else "开始补迁")
                    }
                    backfillProgress?.let {
                        Spacer(Modifier.height(4.dp))
                        Text(it, style = MaterialTheme.typography.bodyMedium)
                    }
                    backfillReport?.let { r ->
                        Spacer(Modifier.height(8.dp))
                        Text("补迁完成：成功 ${r.succeeded}，跳过 ${r.skipped}，失败 ${r.failed}（共 ${r.total}）")
                    }
                    backfillError?.let {
                        Spacer(Modifier.height(8.dp))
                        Text(it, color = MaterialTheme.colorScheme.error)
                    }
                }
            }
            report?.let { r ->
                Spacer(Modifier.height(12.dp))
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Text("导入完成 ✅", style = MaterialTheme.typography.titleMedium)
                        Text("memo：${r.importedMemos} 条")
                        Text("资源：${r.importedResources} 个（跳过 ${r.skippedResources}）")
                        if (r.importedMemos == 0) {
                            Spacer(Modifier.height(4.dp))
                            Text(
                                "memo 均已导入过（本次 0 条新增），可直接使用下方的补迁功能。",
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                }
            }
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

/** 从旧站下载资源（依次尝试多个端点，兼容不同 memos 版本），返回字节或 null */
private suspend fun downloadFromOld(
    client: OkHttpClient,
    oldBase: String,
    oldToken: String,
    r: SkippedResource,
): ByteArray? {
    val candidates = buildList {
        add("$oldBase/api/v1/resources/${r.srcId}/blob")
        r.uid?.let { uid ->
            add("$oldBase/api/v1/resources/$uid/blob")
            add("$oldBase/o/r/$uid")
            add("$oldBase/file/$uid")
        }
    }
    for (url in candidates) {
        try {
            val req = Request.Builder().url(url)
                .addHeader("Authorization", "Bearer $oldToken")
                .build()
            client.newCall(req).execute().use { resp ->
                if (resp.isSuccessful) return resp.body?.bytes()
            }
        } catch (_: Exception) {
            // 尝试下一个端点
        }
    }
    return null
}

/** 把 memo 内容里的旧图片引用（相对与完整 URL 两种形态）重写为新站资源路径 */
private fun rewriteContent(content: String, oldBase: String, oldUid: String, newUrl: String): String {
    var c = content
    for (from in listOf("$oldBase/o/r/$oldUid", "$oldBase/file/$oldUid", "/o/r/$oldUid", "/file/$oldUid")) {
        c = c.replace(from, newUrl)
    }
    return c
}
