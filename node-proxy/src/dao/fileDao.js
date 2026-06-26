import levelDB from '../utils/levelDB'
import crypto from 'crypto'

export const fileInfoTable = 'fileInfoTable_'

// 缓存多少分钟
const cacheTime = 60 * 24

export async function initFileTable() {
  console.log('init db')
}

// 缓存文件信息
export async function cacheFileInfo(fileInfo) {
  fileInfo.path = decodeURIComponent(fileInfo.path)
  const pathKey = fileInfoTable + fileInfo.path
  fileInfo.table = fileInfoTable
  await levelDB.setExpire(pathKey, fileInfo, 1000 * 60 * cacheTime)
}

// 获取文件信息，偶尔要清理一下缓存，这里存储的是真实的文件路径，云盘的路径
export async function getFileInfo(path) {
  const pathKey = decodeURIComponent(fileInfoTable + path)
  const value = await levelDB.getValue(pathKey)
  return value
}

// 获取文件信息
export async function getAllFileInfo() {
  const value = await levelDB.getValue({ table: fileInfoTable })
  return value
}
