package com.babble.app.data

import android.content.Context
import android.content.SharedPreferences

/** JWT 存取（SharedPreferences） */
class TokenStore(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("babble_auth", Context.MODE_PRIVATE)

    var accessToken: String?
        get() = prefs.getString("access_token", null)
        set(value) = prefs.edit().putString("access_token", value).apply()

    var refreshToken: String?
        get() = prefs.getString("refresh_token", null)
        set(value) = prefs.edit().putString("refresh_token", value).apply()

    /** 后端服务器地址（fork 部署用户可配置自己的域名） */
    var serverUrl: String
        get() = prefs.getString("server_url", "https://bb.kyeo.top") ?: "https://bb.kyeo.top"
        set(value) = prefs.edit().putString("server_url", value).apply()

    fun clear() {
        prefs.edit().clear().apply()
    }
}
