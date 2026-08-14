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
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import com.babble.app.data.ImportReport
import com.babble.app.data.MemosDbParser
import com.babble.app.data.ParsedImport
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.File

/** 迁移页：选择 memos.db → 系统 SQLite 解析 → 调导入接口 → 显示报告 */
@Composable
fun MigrateScreen(onBack: () -> Unit) {
    var parsed by remember { mutableStateOf<ParsedImport?>(null) }
    var parsing by remember { mutableStateOf(false) }
    var importing by remember { mutableStateOf(false) }
    var report by remember { mutableStateOf<ImportReport?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

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
                enabled = !parsing && !importing,
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
                                error = e.message ?: "导入失败"
                            } finally {
                                importing = false
                            }
                        }
                    },
                    enabled = !importing,
                ) {
                    Text(if (importing) "导入中…" else "开始导入")
                }
            }
            report?.let { r ->
                Spacer(Modifier.height(12.dp))
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Text("导入完成 ✅", style = MaterialTheme.typography.titleMedium)
                        Text("memo：${r.importedMemos} 条")
                        Text("资源：${r.importedResources} 个（跳过 ${r.skippedResources}）")
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
