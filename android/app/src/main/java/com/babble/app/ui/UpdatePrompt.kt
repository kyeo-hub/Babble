package com.babble.app.ui

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import com.babble.app.data.UpdateChecker
import com.babble.app.data.UpdateInfo
import kotlinx.coroutines.launch
import java.io.File

/** 安装下载好的 APK（FileProvider + ACTION_VIEW） */
fun installApk(context: Context, file: File) {
    val uri = FileProvider.getUriForFile(context, "com.babble.app.fileprovider", file)
    val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(intent)
}

/** 新版本提示对话框：下载 → sha256 校验 → 安装 */
@Composable
fun UpdateAvailableDialog(info: UpdateInfo, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var downloading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = { if (!downloading) onDismiss() },
        title = { Text("发现新版本 ${info.versionName}") },
        text = {
            Column {
                Text(info.notes ?: "是否下载并安装新版本？")
                if (downloading) Text("下载中…")
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !downloading,
                onClick = {
                    downloading = true
                    error = null
                    scope.launch {
                        try {
                            val dest = File(context.cacheDir, "updates/babble.apk")
                            dest.parentFile?.mkdirs()
                            val file = UpdateChecker.download(info.url, dest)
                            val sha = UpdateChecker.sha256(file)
                            if (info.sha256 != null && !info.sha256.equals(sha, ignoreCase = true)) {
                                error = "文件校验失败，请重试"
                            } else {
                                installApk(context, file)
                                onDismiss()
                            }
                        } catch (e: Exception) {
                            error = "更新失败：${e.message}"
                        } finally {
                            downloading = false
                        }
                    }
                },
            ) {
                Text(if (downloading) "下载中…" else "下载并安装")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !downloading) { Text("稍后") }
        },
    )
}
