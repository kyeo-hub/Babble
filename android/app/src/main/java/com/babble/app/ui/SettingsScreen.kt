@file:OptIn(ExperimentalMaterial3Api::class)

package com.babble.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import com.babble.app.data.UpdateMeRequest
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
            Modifier.fillMaxSize().padding(padding).padding(16.dp),
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
        }
    }
}
