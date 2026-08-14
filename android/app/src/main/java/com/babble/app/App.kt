package com.babble.app

import android.content.Context
import com.babble.app.data.ApiClient
import com.babble.app.data.TokenStore

/** 应用级单例：API 客户端与令牌存储 */
object App {
    /** APP 更新清单（GitHub Releases latest 资产；fork 用户改为自己仓库地址） */
    const val UPDATE_MANIFEST_URL =
        "https://github.com/kyeo-hub/Babble/releases/latest/download/update.json"

    lateinit var api: ApiClient
        private set
    lateinit var tokenStore: TokenStore
        private set
    private lateinit var appContext: Context

    fun init(context: Context) {
        appContext = context.applicationContext
        tokenStore = TokenStore(appContext)
        api = ApiClient(tokenStore, tokenStore.serverUrl)
    }

    /** 切换服务器地址：持久化并重建 API 客户端（旧令牌归属旧服务器，调用方需清除并重新登录） */
    fun configure(url: String) {
        val normalized = url.trim().trimEnd('/')
        tokenStore.serverUrl = normalized
        api = ApiClient(tokenStore, normalized)
    }
}
