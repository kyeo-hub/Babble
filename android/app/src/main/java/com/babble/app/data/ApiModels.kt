package com.babble.app.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class LoginRequest(val username: String, val password: String)

@Serializable
data class LoginResponse(
    @SerialName("accessToken") val accessToken: String,
    @SerialName("refreshToken") val refreshToken: String,
    val user: User,
)

@Serializable
data class User(
    val id: Long,
    val uid: String,
    val username: String,
    val role: String,
    @SerialName("createdTs") val createdTs: Long,
)

@Serializable
data class Resource(
    val id: Long,
    val uid: String,
    @SerialName("memoId") val memoId: Long? = null,
    val name: String,
    val type: String,
    val size: Long,
    val url: String,
    @SerialName("createdTs") val createdTs: Long,
)

@Serializable
data class Memo(
    val id: Long,
    val uid: String,
    val content: String,
    val visibility: String,
    val pinned: Boolean,
    @SerialName("rowStatus") val rowStatus: String,
    val tags: List<String> = emptyList(),
    val resources: List<Resource> = emptyList(),
    @SerialName("createdTs") val createdTs: Long,
    @SerialName("updatedTs") val updatedTs: Long,
)

@Serializable
data class MemoListResponse(
    val items: List<Memo>,
    val page: Int,
    @SerialName("page_size") val pageSize: Int,
    val total: Long,
)

@Serializable
data class CreateMemoRequest(
    val content: String,
    val visibility: String = "private",
)

@Serializable
data class UpdateMemoRequest(
    val content: String? = null,
    val visibility: String? = null,
    val pinned: Boolean? = null,
    @SerialName("rowStatus") val rowStatus: String? = null,
)

// ---------- 迁移导入（与后端 /api/v1/migrate/import 契约一致） ----------

@Serializable
data class ImportPayload(
    @SerialName("batchId") val batchId: String? = null,
    val memos: List<ImportMemo>,
    val resources: List<ImportResource> = emptyList(),
)

@Serializable
data class ImportMemo(
    val uid: String? = null,
    val content: String,
    val visibility: String = "private",
    val pinned: Int = 0,
    @SerialName("rowStatus") val rowStatus: String = "normal",
    @SerialName("createdTs") val createdTs: Long,
    @SerialName("updatedTs") val updatedTs: Long? = null,
)

@Serializable
data class ImportResource(
    @SerialName("memoIndex") val memoIndex: Int? = null,
    val uid: String? = null,
    val name: String,
    val type: String,
    val size: Long? = null,
    @SerialName("dataBase64") val dataBase64: String? = null,
)

@Serializable
data class ImportReport(
    @SerialName("batchId") val batchId: String? = null,
    @SerialName("importedMemos") val importedMemos: Int,
    @SerialName("importedResources") val importedResources: Int,
    @SerialName("skippedResources") val skippedResources: Int,
)

// ---------- 修改账号（PATCH /api/v1/me） ----------

@Serializable
data class UpdateMeRequest(
    val username: String? = null,
    @SerialName("currentPassword") val currentPassword: String,
    @SerialName("newPassword") val newPassword: String? = null,
)

// ---------- APP 内补迁报告（UI 展示用，非 API 模型） ----------

data class BackfillReport(
    val total: Int,
    val succeeded: Int,
    val skipped: Int,
    val failed: Int,
)
