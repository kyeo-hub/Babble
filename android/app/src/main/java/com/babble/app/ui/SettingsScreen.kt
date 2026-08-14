@file:OptIn(ExperimentalMaterial3Api::class)

package com.babble.app.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** 设置页：切换服务器地址（改后需重新登录） */
@Composable
fun SettingsScreen(currentUrl: String, onSave: (String) -> Unit, onBack: () -> Unit) {
    var url by remember { mutableStateOf(currentUrl) }
    var error by remember { mutableStateOf<String?>(null) }

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
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
            Text("服务器地址", style = MaterialTheme.typography.titleMedium)
            Text(
                "连接的后端地址，如 https://bb.kyeo.top",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = url,
                onValueChange = { url = it },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("https://bb.kyeo.top") },
            )
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = {
                    val u = url.trim().trimEnd('/')
                    if (!u.startsWith("http://") && !u.startsWith("https://")) {
                        error = "地址需以 http(s):// 开头"
                        return@Button
                    }
                    onSave(u)
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("保存并重新登录")
            }
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = MaterialTheme.colorScheme.error)
            }
        }
    }
}
