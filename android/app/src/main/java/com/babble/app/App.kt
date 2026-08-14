package com.babble.app

import android.content.Context
import com.babble.app.data.ApiClient
import com.babble.app.data.TokenStore

/** 应用级单例：API 客户端与令牌存储 */
object App {
    lateinit var api: ApiClient
        private set
    lateinit var tokenStore: TokenStore
        private set

    fun init(context: Context, baseUrl: String = "https://bb.kyeo.top") {
        tokenStore = TokenStore(context.applicationContext)
        api = ApiClient(tokenStore, baseUrl)
    }
}
