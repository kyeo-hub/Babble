@file:OptIn(ExperimentalMaterial3Api::class)

package com.babble.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Upload
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.babble.app.App
import com.babble.app.data.Memo
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private fun formatTime(ts: Long): String =
    SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault()).format(Date(ts * 1000))

/** memo 列表：分页加载 + 下拉刷新 + 操作菜单（置顶/归档/删除） */
@Composable
fun MemoListScreen(
    onNewMemo: () -> Unit,
    onEditMemo: (Memo) -> Unit,
    onMigrate: () -> Unit,
    onSettings: () -> Unit,
    onLogout: () -> Unit,
) {
    var memos by remember { mutableStateOf<List<Memo>>(emptyList()) }
    var page by remember { mutableStateOf(1) }
    var total by remember { mutableStateOf(0L) }
    var loading by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var deleteTarget by remember { mutableStateOf<Memo?>(null) }
    val scope = rememberCoroutineScope()

    fun loadFirst() {
        scope.launch {
            refreshing = true
            try {
                val resp = App.api.api.listMemos(page = 1)
                memos = resp.items
                page = 1
                total = resp.total
                error = null
            } catch (e: Exception) {
                error = e.message ?: "加载失败"
            } finally {
                refreshing = false
                loading = false
            }
        }
    }

    fun loadMore() {
        if (loading || memos.size >= total) return
        loading = true
        scope.launch {
            try {
                val next = page + 1
                val resp = App.api.api.listMemos(page = next)
                memos = memos + resp.items
                page = next
                total = resp.total
                error = null
            } catch (e: Exception) {
                error = e.message ?: "加载失败"
            } finally {
                loading = false
            }
        }
    }

    fun runOp(block: suspend () -> Unit) {
        scope.launch {
            try {
                block()
                loadFirst()
            } catch (e: Exception) {
                error = e.message ?: "操作失败"
            }
        }
    }

    LaunchedEffect(Unit) { loadFirst() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Babble") },
                actions = {
                    IconButton(onClick = onSettings) { Icon(Icons.Default.Settings, contentDescription = "设置") }
                    IconButton(onClick = onMigrate) { Icon(Icons.Default.Upload, contentDescription = "迁移数据") }
                    IconButton(onClick = onLogout) { Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = "登出") }
                },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onNewMemo) { Icon(Icons.Default.Add, contentDescription = "新建") }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { loadFirst() },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(memos, key = { it.id }) { memo ->
                    MemoCard(
                        memo = memo,
                        onClick = { onEditMemo(memo) },
                        onTogglePin = { runOp { App.api.api.togglePin(memo.id) } },
                        onToggleArchive = { runOp { App.api.api.toggleArchive(memo.id) } },
                        onDelete = { deleteTarget = memo },
                    )
                }
                item {
                    when {
                        loading -> CircularProgressIndicator(Modifier.padding(16.dp))
                        memos.size < total -> LaunchedEffect(memos.size) { loadMore() }
                        memos.isEmpty() && error == null -> Text("暂无 memo，点右下角新建", Modifier.padding(16.dp))
                    }
                    error?.let {
                        Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(8.dp))
                    }
                }
            }
        }
    }

    deleteTarget?.let { memo ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("删除 memo") },
            text = { Text("确定删除这条 memo 吗？此操作不可恢复。") },
            confirmButton = {
                TextButton(onClick = {
                    deleteTarget = null
                    runOp { App.api.api.deleteMemo(memo.id) }
                }) { Text("删除") }
            },
            dismissButton = {
                TextButton(onClick = { deleteTarget = null }) { Text("取消") }
            },
        )
    }
}

@Composable
private fun MemoCard(
    memo: Memo,
    onClick: () -> Unit,
    onTogglePin: () -> Unit,
    onToggleArchive: () -> Unit,
    onDelete: () -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (memo.pinned) {
                    Icon(
                        Icons.Default.PushPin,
                        contentDescription = "置顶",
                        modifier = Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
                memo.tags.take(3).forEach { tag ->
                    Spacer(Modifier.width(6.dp))
                    Text("#$tag", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                }
                Spacer(Modifier.weight(1f))
                Text(formatTime(memo.createdTs), style = MaterialTheme.typography.bodySmall)
                Box {
                    IconButton(onClick = { menuOpen = true }) {
                        Icon(Icons.Default.MoreVert, contentDescription = "更多操作")
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        DropdownMenuItem(
                            text = { Text(if (memo.pinned) "取消置顶" else "置顶") },
                            onClick = { menuOpen = false; onTogglePin() },
                        )
                        DropdownMenuItem(
                            text = { Text(if (memo.rowStatus == "archived") "取消归档" else "归档") },
                            onClick = { menuOpen = false; onToggleArchive() },
                        )
                        DropdownMenuItem(
                            text = { Text("删除", color = MaterialTheme.colorScheme.error) },
                            onClick = { menuOpen = false; onDelete() },
                        )
                    }
                }
            }
            Spacer(Modifier.height(6.dp))
            MarkdownText(memo.content)
        }
    }
}
