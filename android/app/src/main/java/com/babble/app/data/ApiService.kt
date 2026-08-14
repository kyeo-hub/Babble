package com.babble.app.data

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface ApiService {

    @POST("api/v1/auth/login")
    suspend fun login(@Body request: LoginRequest): LoginResponse

    @GET("api/v1/me")
    suspend fun me(): User

    @GET("api/v1/memos")
    suspend fun listMemos(
        @Query("page") page: Int = 1,
        @Query("page_size") pageSize: Int = 20,
        @Query("tag") tag: String? = null,
        @Query("visibility") visibility: String? = null,
        @Query("archived") archived: String? = null,
        @Query("keyword") keyword: String? = null,
    ): MemoListResponse

    @POST("api/v1/memos")
    suspend fun createMemo(@Body request: CreateMemoRequest): Memo

    @GET("api/v1/memos/{id}")
    suspend fun getMemo(@Path("id") id: Long): Memo

    @PATCH("api/v1/memos/{id}")
    suspend fun updateMemo(@Path("id") id: Long, @Body request: UpdateMemoRequest): Memo

    @DELETE("api/v1/memos/{id}")
    suspend fun deleteMemo(@Path("id") id: Long): Response<Unit>

    @POST("api/v1/memos/{id}/pin")
    suspend fun togglePin(@Path("id") id: Long): Memo

    @POST("api/v1/memos/{id}/archive")
    suspend fun toggleArchive(@Path("id") id: Long): Memo

    @POST("api/v1/migrate/import")
    suspend fun importMemos(@Body payload: ImportPayload): ImportReport
}
