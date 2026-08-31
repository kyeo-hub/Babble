@file:OptIn(ExperimentalMaterial3Api::class)

package com.babble.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.babble.app.App
import com.babble.app.BuildConfig
import com.babble.app.data.ReportIssueRequest
import com.babble.app.data.UpdateChecker
import com.babble.app.data.UpdateInfo
import com.babble.app.data.UpdateMeRequest
import com.babble.app.data.friendlyMessage
import kotlinx.coroutines.launch

/** 设置页：服务器地址 + 修改账号（用户名 / 密码） */
@Composable
fun SettingsScreen(
    currentUrl: String,
    onSave: (String) -> Unit,
    onAccountUpdated: () -> Unit,
    onBack: () -> Unit,
) {
    var url by remember { mutableStateOf(currentUrl) }
    var urlError by remember { mutableStateOf<String?>(null) }

    var currentUsername by remember { mutableStateOf("") }
    var currentPassword by remember { mutableStateOf("") }
    var newUsername by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var savingAccount by remember { mutableStateOf(false) }
    var accountError by remember { mutableStateOf<String?>(null) }

    // 检查更新
    var checkingUpdate by remember { mutableStateOf(false) }
    var updateState by remember { mutableStateOf<String?>(null) }
    var updateInfo by remember { mutableStateOf<UpdateInfo?>(null) }
    var showUpdateDialog by remember { mutableStateOf(false) }

    // 反馈 / 报告问题
    var reportText by remember { mutableStateOf("") }
    var reporting by remember { mutableStateOf(false) }
    var reportResult by remember { mutableStateOf<String?>(null) }
    var reportError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    // 加载当前用户名（GET /me，仅用于展示）
    LaunchedEffect(Unit) {
        try {
            currentUsername = App.api.api.me().username
        } catch (_: Exception) {
            // 忽略
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("设置") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("服务器地址", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
                value = url,
                onValueChange = { url = it },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("https://bb.kyeo.top") },
            )
            Button(
                onClick = {
                    val u = url.trim().trimEnd('/')
                    if (!u.startsWith("http://") && !u.startsWith("https://")) {
                        urlError = "地址需以 http(s):// 开头"
                        return@Button
                    }
                    onSave(u)
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("保存并重新登录")
            }
            urlError?.let {
                Text(it, color = MaterialTheme.colorScheme.error)
            }

            HorizontalDivider(Modifier.padding(vertical = 8.dp))

            Text("修改账号（用户名 / 密码）", style = MaterialTheme.typography.titleMedium)
            Text(
                "当前用户名：$currentUsername",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = currentPassword,
                onValueChange = { currentPassword = it },
                label = { Text("当前密码") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = newUsername,
                onValueChange = { newUsername = it },
                label = { Text("新用户名（可选）") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = newPassword,
                onValueChange = { newPassword = it },
                label = { Text("新密码（可选，至少 8 位）") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = {
                    if (currentPassword.isBlank()) {
                        accountError = "请输入当前密码"
                        return@Button
                    }
                    if (newUsername.isBlank() && newPassword.isBlank()) {
                        accountError = "请填写新用户名或新密码"
                        return@Button
                    }
                    if (newPassword.isNotBlank() && newPassword.length < 8) {
                        accountError = "新密码至少 8 位"
                        return@Button
                    }
                    savingAccount = true
                    accountError = null
                    scope.launch {
                        try {
                            App.api.api.updateMe(
                                UpdateMeRequest(
                                    username = newUsername.ifBlank { null },
                                    currentPassword = currentPassword,
                                    newPassword = newPassword.ifBlank { null },
                                ),
                            )
                            onAccountUpdated()
                        } catch (e: Exception) {
                            accountError = e.message ?: "修改失败"
                        } finally {
                            savingAccount = false
                        }
                    }
                },
                enabled = !savingAccount,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (savingAccount) "保存中…" else "保存修改")
            }
            accountError?.let {
                Text(it, color = MaterialTheme.colorScheme.error)
            }

            HorizontalDivider(Modifier.padding(vertical = 8.dp))

            Text("更新", style = MaterialTheme.typography.titleMedium)
            Button(
                onClick = {
                    checkingUpdate = true
                    updateState = null
                    scope.launch {
                        try {
                            val info = UpdateChecker.check(App.UPDATE_MANIFEST_URL)
                            if (info == null) {
                                updateState = "检查失败或暂无更新源"
                            } else if (info.versionCode > BuildConfig.VERSION_CODE) {
                                updateInfo = info
                                showUpdateDialog = true
                            } else {
                                updateState = "已是最新版本（v${info.versionName}）"
                            }
                        } catch (e: Exception) {
                            updateState = "检查更新失败：${e.message}"
                        } finally {
                            checkingUpdate = false
                        }
                    }
                },
                enabled = !checkingUpdate,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (checkingUpdate) "检查中…" else "检查更新")
            }
            updateState?.let {
                Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            HorizontalDivider(Modifier.padding(vertical = 8.dp))

            Text("反馈 / 报告问题", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
                value = reportText,
                onValueChange = { reportText = it },
                label = { Text("问题描述（必填，会自动附带版本与服务器信息）") },
                minLines = 3,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = {
                    val desc = reportText.trim()
                    if (desc.isEmpty()) {
                        reportError = "请填写问题描述"
                        return@Button
                    }
                    reporting = true
                    reportResult = null
                    reportError = null
                    scope.launch {
                        try {
                            val body = buildString {
                                appendLine("## 问题描述")
                                appendLine(desc)
                                appendLine()
                                appendLine("## 环境信息")
                                appendLine("- APP 版本：${BuildConfig.VERSION_NAME}（${BuildConfig.VERSION_CODE}）")
                                appendLine("- 服务器地址：${App.tokenStore.serverUrl}")
                                appendLine("- 设备时间：${System.currentTimeMillis()}")
                            }
                            val resp = App.api.api.reportIssue(
                                ReportIssueRequest(
                                    title = "[APP 反馈] ${desc.take(40)}",
                                    body = body,
                                ),
                            )
                            reportResult = "已提交 Issue #${resp.number}：${resp.url}"
                        } catch (e: Exception) {
                            reportError = "上报失败：${e.friendlyMessage()}"
                        } finally {
                            reporting = false
                        }
                    }
                },
                enabled = !reporting,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (reporting) "提交中…" else "报告问题")
            }
            reportResult?.let {
                Spacer(Modifier.height(4.dp))
                Text(it, color = MaterialTheme.colorScheme.primary)
            }
            reportError?.let {
                Spacer(Modifier.height(4.dp))
                Text(it, color = MaterialTheme.colorScheme.error)
            }
        }
    }

    if (showUpdateDialog && updateInfo != null) {
        UpdateAvailableDialog(info = updateInfo!!, onDismiss = { showUpdateDialog = false })
    }
}
