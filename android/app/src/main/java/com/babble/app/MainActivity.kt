package com.babble.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.babble.app.data.Memo
import com.babble.app.data.UpdateChecker
import com.babble.app.data.UpdateInfo
import com.babble.app.ui.LoginScreen
import com.babble.app.ui.MemoEditScreen
import com.babble.app.ui.MemoListScreen
import com.babble.app.ui.MigrateScreen
import com.babble.app.ui.SettingsScreen
import com.babble.app.ui.UpdateAvailableDialog

sealed interface Screen {
    data object MemoList : Screen
    data class MemoEdit(val memo: Memo? = null) : Screen
    data object Migrate : Screen
    data object Settings : Screen
}

class MainActivity : ComponentActivity() {
    private var loggedIn by mutableStateOf(false)
    private var screen by mutableStateOf<Screen>(Screen.MemoList)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        App.init(this)
        loggedIn = App.tokenStore.accessToken != null
        // 401 自动登出
        App.api.onUnauthorized = {
            App.tokenStore.clear()
            loggedIn = false
            screen = Screen.MemoList
        }
        setContent {
            MaterialTheme {
                // 启动自动检查更新
                var updateInfo by remember { mutableStateOf<UpdateInfo?>(null) }
                LaunchedEffect(Unit) {
                    val info = UpdateChecker.check(App.UPDATE_MANIFEST_URL)
                    if (info != null && info.versionCode > BuildConfig.VERSION_CODE) {
                        updateInfo = info
                    }
                }
                updateInfo?.let { info ->
                    UpdateAvailableDialog(info = info, onDismiss = { updateInfo = null })
                }

                if (!loggedIn) {
                    LoginScreen(onLoginSuccess = { loggedIn = true; screen = Screen.MemoList })
                } else {
                    BackHandler(enabled = screen is Screen.MemoEdit || screen is Screen.Migrate || screen is Screen.Settings) {
                        screen = Screen.MemoList
                    }
                    Surface(modifier = Modifier.fillMaxSize()) {
                        when (val s = screen) {
                            Screen.MemoList -> MemoListScreen(
                                onNewMemo = { screen = Screen.MemoEdit(null) },
                                onEditMemo = { screen = Screen.MemoEdit(it) },
                                onMigrate = { screen = Screen.Migrate },
                                onSettings = { screen = Screen.Settings },
                                onLogout = {
                                    App.tokenStore.clear()
                                    loggedIn = false
                                    screen = Screen.MemoList
                                },
                            )
                            is Screen.MemoEdit -> MemoEditScreen(
                                memo = s.memo,
                                onSaved = { screen = Screen.MemoList },
                                onBack = { screen = Screen.MemoList },
                            )
                            Screen.Migrate -> MigrateScreen(
                                onBack = { screen = Screen.MemoList },
                            )
                            Screen.Settings -> SettingsScreen(
                                currentUrl = App.tokenStore.serverUrl,
                                onSave = { url ->
                                    App.configure(url)
                                    App.tokenStore.clear()
                                    loggedIn = false
                                    screen = Screen.MemoList
                                },
                                onAccountUpdated = {
                                    App.tokenStore.clear()
                                    loggedIn = false
                                    screen = Screen.MemoList
                                },
                                onBack = { screen = Screen.MemoList },
                            )
                        }
                    }
                }
            }
        }
    }
}
