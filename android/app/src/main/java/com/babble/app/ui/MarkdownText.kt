package com.babble.app.ui

import android.widget.TextView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import coil.ImageLoader
import coil.request.Disposable
import coil.request.ImageRequest
import com.babble.app.App
import io.noties.markwon.Markwon
import io.noties.markwon.image.AsyncDrawable
import io.noties.markwon.image.coil.CoilImagesPlugin
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * Markwon 渲染 Markdown；图片走 Coil（CoilImagesPlugin），
 * 通过带 Bearer 头的 OkHttp 加载（资源直出接口需要鉴权）。
 */
@Composable
fun MarkdownText(markdown: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val markwon = remember {
        val client = OkHttpClient.Builder()
            .addInterceptor { chain ->
                val request = chain.request().newBuilder()
                    .addHeader("Authorization", "Bearer ${App.tokenStore.accessToken.orEmpty()}")
                    .build()
                chain.proceed(request)
            }
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
        val imageLoader = ImageLoader.Builder(context).okHttpClient(client).build()
        val coilPlugin = CoilImagesPlugin.create(
            object : CoilImagesPlugin.CoilStore {
                override fun load(drawable: AsyncDrawable): ImageRequest {
                    return ImageRequest.Builder(context)
                        .data(resolveImageUrl(drawable.destination) ?: drawable.destination)
                        .build()
                }

                override fun cancel(disposable: Disposable) {
                    disposable.dispose()
                }
            },
            imageLoader,
        )
        Markwon.builder(context)
            .usePlugin(coilPlugin)
            .build()
    }
    AndroidView(
        factory = { ctx -> TextView(ctx) },
        update = { tv -> markwon.setMarkdown(tv, markdown) },
        modifier = modifier,
    )
}

/** 相对路径补全为完整 URL（基于配置的服务器地址） */
private fun resolveImageUrl(destination: String?): String? {
    if (destination.isNullOrBlank()) return null
    return if (destination.startsWith("http://") || destination.startsWith("https://")) {
        destination
    } else {
        App.tokenStore.serverUrl.trimEnd('/') + "/" + destination.trimStart('/')
    }
}
