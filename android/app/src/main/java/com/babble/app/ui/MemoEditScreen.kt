@file:OptIn(ExperimentalMaterial3Api::class)

package com.babble.app.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.babble.app.App
import com.babble.app.data.CreateMemoRequest
import com.babble.app.data.Memo
import com.babble.app.data.UpdateMemoRequest
import kotlinx.coroutines.launch

/** 新建 / 编辑 memo */
@Composable
fun MemoEditScreen(
    memo: Memo?,
    onSaved: () -> Unit,
    onBack: () -> Unit,
) {
    var content by remember { mutableStateOf(memo?.content ?: "") }
    var visibility by remember { mutableStateOf(memo?.visibility ?: "private") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (memo == null) "新建 memo" else "编辑 memo") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    TextButton(
                        onClick = {
                            if (content.isBlank()) {
                                error = "内容不能为空"
                                return@TextButton
                            }
                            saving = true
                            error = null
                            scope.launch {
                                try {
                                    if (memo == null) {
                                        App.api.api.createMemo(CreateMemoRequest(content = content, visibility = visibility))
                                    } else {
                                        App.api.api.updateMemo(memo.id, UpdateMemoRequest(content = content, visibility = visibility))
                                    }
                                    onSaved()
                                } catch (e: Exception) {
                                    error = e.message ?: "保存失败"
                                } finally {
                                    saving = false
                                }
                            }
                        },
                        enabled = !saving,
                    ) {
                        Text(if (saving) "保存中…" else "保存")
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(12.dp)) {
            Row {
                Text("可见性：", modifier = Modifier.padding(top = 6.dp))
                Spacer(Modifier.width(8.dp))
                FilterChip(
                    selected = visibility == "public",
                    onClick = { visibility = "public" },
                    label = { Text("public") },
                )
                Spacer(Modifier.width(8.dp))
                FilterChip(
                    selected = visibility == "private",
                    onClick = { visibility = "private" },
                    label = { Text("private") },
                )
            }
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = content,
                onValueChange = { content = it },
                modifier = Modifier.fillMaxSize(),
                placeholder = { Text("支持 Markdown…") },
            )
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = MaterialTheme.colorScheme.error)
            }
        }
    }
}
