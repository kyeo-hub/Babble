package com.babble.app.ui

import android.widget.TextView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import io.noties.markwon.Markwon

/** Markwon 渲染 Markdown（AndroidView 托管 TextView） */
@Composable
fun MarkdownText(markdown: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val markwon = remember { Markwon.create(context) }
    AndroidView(
        factory = { ctx -> TextView(ctx) },
        update = { tv -> markwon.setMarkdown(tv, markdown) },
        modifier = modifier,
    )
}
