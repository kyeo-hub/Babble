package com.babble.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.parseToJsonElement
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

/** 提取后端 JSON 错误消息（如 {error:{message}}），回退到原始异常信息 */
fun Throwable.friendlyMessage(): String {
    val fromBody = (this as? retrofit2.HttpException)?.let { http ->
        try {
            val body = http.response()?.errorBody()?.string()
            if (!body.isNullOrBlank()) {
                Json { ignoreUnknownKeys = true }
                    .parseToJsonElement(body)
                    .jsonObject["error"]?.jsonObject?.get("message")?.jsonPrimitive?.content
            } else null
        } catch (_: Exception) {
            null
        }
    }
    return fromBody ?: (message ?: "未知错误")
}

/** 后端 API 客户端：JWT 注入 + 日志 + Retrofit 封装 */
class ApiClient(private val tokenStore: TokenStore, baseUrl: String) {

    /** 收到 401 时回调（用于自动登出） */
    var onUnauthorized: (() -> Unit)? = null

    private val json = Json { ignoreUnknownKeys = true }

    private val authInterceptor = Interceptor { chain ->
        val token = tokenStore.accessToken
        val request = chain.request().newBuilder()
            .apply {
                if (!token.isNullOrBlank()) header("Authorization", "Bearer $token")
            }
            .build()
        val response = chain.proceed(request)
        if (response.code == 401) onUnauthorized?.invoke()
        response
    }

    private val okHttp = OkHttpClient.Builder()
        .addInterceptor(authInterceptor)
        .addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val retrofit = Retrofit.Builder()
        .baseUrl(baseUrl.trimEnd('/') + "/")
        .client(okHttp)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()

    val api: ApiService = retrofit.create(ApiService::class.java)
}
