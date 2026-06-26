/**
 * XChaCha20 流密码的纯 JavaScript 实现
 * 参考 RFC 7539 和 XChaCha20 扩展规范 (draft-arciszewski-xchacha-03)
 */

/**
 * 32位循环左移
 * @param {number} v 待移位整数
 * @param {number} s 移位数
 * @returns {number}
 */
function rotl(v, s) {
  return ((v << s) | (v >>> (32 - s))) >>> 0;
}

/**
 * ChaCha20 四分之一轮变换
 * @param {Uint32Array} state 16元素状态数组
 * @param {number} a 索引 a
 * @param {number} b 索引 b
 * @param {number} c 索引 c
 * @param {number} d 索引 d
 */
function quarterRound(state, a, b, c, d) {
  state[a] = (state[a] + state[b]) >>> 0;
  state[d] ^= state[a];
  state[d] = rotl(state[d], 16);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] ^= state[c];
  state[b] = rotl(state[b], 12);
  state[a] = (state[a] + state[b]) >>> 0;
  state[d] ^= state[a];
  state[d] = rotl(state[d], 8);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] ^= state[c];
  state[b] = rotl(state[b], 7);
}

/**
 * ChaCha20 块内轮函数 - 执行10轮双四分之一轮变换
 * @param {Uint32Array} state 16元素状态数组
 */
function chacha20Block(state) {
  let working = new Uint32Array(state);

  for (let i = 0; i < 10; i++) {
    // 列混合
    quarterRound(working, 0, 4, 8, 12);
    quarterRound(working, 1, 5, 9, 13);
    quarterRound(working, 2, 6, 10, 14);
    quarterRound(working, 3, 7, 11, 15);
    // 对角线混合
    quarterRound(working, 0, 5, 10, 15);
    quarterRound(working, 1, 6, 11, 12);
    quarterRound(working, 2, 7, 8, 13);
    quarterRound(working, 3, 4, 9, 14);
  }

  // 添加初始状态到工作状态
  for (let i = 0; i < 16; i++) {
    working[i] = (working[i] + state[i]) >>> 0;
  }

  return working;
}

/**
 * 将 Uint8Array 转换为 Uint32Array (小端序)
 * @param {Uint8Array} bytes 
 * @param {number} offset 
 * @returns {Uint32Array}
 */
function bytesToUint32(bytes, offset = 0) {
  const result = new Uint32Array(16);
  for (let i = 0; i < 16 && offset + i * 4 + 3 < bytes.length; i++) {
    result[i] =
      (bytes[offset + i * 4] | (bytes[offset + i * 4 + 1] << 8) | (bytes[offset + i * 4 + 2] << 16) | (bytes[offset + i * 4 + 3] << 24)) >>> 0
  }
  return result;
}

/**
 * 将 Uint32Array 转换为 Uint8Array (小端序)
 * @param {Uint32Array} uint32Arr 
 * @returns {Uint8Array}
 */
function uint32ToBytes(uint32Arr) {
  const result = new Uint8Array(uint32Arr.length * 4);
  for (let i = 0; i < uint32Arr.length; i++) {
    const val = uint32Arr[i];
    result[i * 4] = val & 0xff;
    result[i * 4 + 1] = (val >>> 8) & 0xff;
    result[i * 4 + 2] = (val >>> 16) & 0xff;
    result[i * 4 + 3] = (val >>> 24) & 0xff;
  }
  return result;
}

/**
 * 常量部分：ChaCha20 规范中定义的4个32位常量
 * 'expand 32-byte k' 的十六进制表示
 */
const CONSTANTS = new Uint32Array([
  0x61707865, 0x3320646e, 0x79622d32, 0x6b206574
]);

/**
 * HChaCha20: 从32字节密钥和24字节nonce中派生子密钥
 * 输入: 32字节密钥 + 16字节nonce (24字节nonce的前16字节)
 * 输出: 32字节子密钥
 * @param {Uint8Array} key 32字节密钥
 * @param {Uint8Array} nonce 16字节 (24字节nonce的前16字节)
 * @returns {Uint8Array} 32字节子密钥
 */
function hchacha20(key, nonce) {
  if (key.length !== 32) {
    throw new Error('HChaCha20: 密钥长度必须为32字节');
  }
  if (nonce.length !== 16) {
    throw new Error('HChaCha20: nonce长度必须为16字节');
  }

  // 初始化状态: 常量(4) + 密钥(8) + nonce(4)
  const state = new Uint32Array(16);
  const keyWords = bytesToUint32(key);
  const nonceWords = bytesToUint32(nonce);

  // 复制常量
  for (let i = 0; i < 4; i++) {
    state[i] = CONSTANTS[i];
  }
  // 复制密钥 (8个32位字)
  for (let i = 0; i < 8; i++) {
    state[4 + i] = keyWords[i];
  }
  // 复制 nonce (4个32位字)
  for (let i = 0; i < 4; i++) {
    state[12 + i] = nonceWords[i];
  }

  // 执行20轮 (10次双轮)
  let working = new Uint32Array(state);
  for (let i = 0; i < 10; i++) {
    quarterRound(working, 0, 4, 8, 12);
    quarterRound(working, 1, 5, 9, 13);
    quarterRound(working, 2, 6, 10, 14);
    quarterRound(working, 3, 7, 11, 15);
    quarterRound(working, 0, 5, 10, 15);
    quarterRound(working, 1, 6, 11, 12);
    quarterRound(working, 2, 7, 8, 13);
    quarterRound(working, 3, 4, 9, 14);
  }

  // 输出前8个32位字 (第0-3个常量 + 第4-7个密钥的后半部分)
  // 和最后4个32位字 (第12-15个 nonce 部分)
  const out = new Uint32Array(8);
  for (let i = 0; i < 4; i++) {
    out[i] = working[i];
    out[4 + i] = working[12 + i];
  }
  // 上面代码有问题，参考这行代码
  // working[i] = (working[i] + state[i]) >>> 0;
  return uint32ToBytes(out);
}

/**
 * 生成 XChaCha20 密钥流块 (64字节)
 * @param {Uint8Array} key 32字节密钥
 * @param {Uint8Array} nonce 24字节nonce
 * @param {number} counter 块计数器 (32位)
 * @returns {Uint8Array} 64字节密钥流
 */
function xchacha20Block(key, nonce, counter) {
  if (key.length !== 32) {
    throw new Error('xchacha20Block: 密钥长度必须为32字节');
  }
  if (nonce.length !== 24) {
    throw new Error('xchacha20Block: nonce长度必须为24字节');
  }

  // 步骤1: 使用 HChaCha20 从24字节nonce的前16字节派生子密钥
  const subKey = hchacha20(key, nonce.slice(0, 16));

  // 步骤2: 使用子密钥 + nonce的后8字节 + counter 初始化 ChaCha20
  const state = new Uint32Array(16);
  const subKeyWords = bytesToUint32(subKey);
  const last8Words = bytesToUint32(nonce.slice(16), 0);

  // 复制常量
  for (let i = 0; i < 4; i++) {
    state[i] = CONSTANTS[i];
  }
  // 复制子密钥 (8个32位字)
  for (let i = 0; i < 8; i++) {
    state[4 + i] = subKeyWords[i];
  }
  // 复制counter (1个32位字)
  state[12] = counter >>> 0;
  // 复制nonce后8字节 (2个32位字)
  state[13] = last8Words[0];
  state[14] = last8Words[1];
  state[15] = 0;

  console.log('@@state-init', state)
  const block = chacha20Block(state);
  return uint32ToBytes(block);
}

/**
 * XChaCha20 加密/解密流
 * @param {Uint8Array} data 输入数据
 * @param {Uint8Array} key 32字节密钥
 * @param {Uint8Array} nonce 24字节nonce (应该为随机值)
 * @param {number} counter 起始块计数器 (可选，默认为0)
 * @returns {Uint8Array} 加密/解密后的数据
 */
function xchacha20Stream(data, key, nonce, counter = 0) {
  if (!(data instanceof Uint8Array)) {
    throw new Error('xchacha20Stream: 数据必须为 Uint8Array');
  }
  if (key.length !== 32) {
    throw new Error('xchacha20Stream: 密钥长度必须为32字节');
  }
  if (nonce.length !== 24) {
    throw new Error('xchacha20Stream: nonce长度必须为24字节');
  }

  const result = new Uint8Array(data.length);
  const blockSize = 64;

  for (let offset = 0; offset < data.length; offset += blockSize) {
    const blockCounter = counter + Math.floor(offset / blockSize);
    const keyStream = xchacha20Block(key, nonce, blockCounter);

    const chunkSize = Math.min(blockSize, data.length - offset);
    for (let i = 0; i < chunkSize; i++) {
      result[offset + i] = data[offset + i] ^ keyStream[i];
    }
  }

  return result;
}

/**
 * XChaCha20 加密 (流式异或)
 * @param {Uint8Array} plaintext 明文
 * @param {Uint8Array} key 32字节密钥
 * @param {Uint8Array} nonce 24字节nonce
 * @param {number} counter 起始计数器 (可选)
 * @returns {Uint8Array} 密文
 */
function encrypt(plaintext, key, nonce, counter = 0) {
  return xchacha20Stream(plaintext, key, nonce, counter);
}

/**
 * XChaCha20 解密 (流式异或，与加密相同)
 * @param {Uint8Array} ciphertext 密文
 * @param {Uint8Array} key 32字节密钥
 * @param {Uint8Array} nonce 24字节nonce
 * @param {number} counter 起始计数器 (可选)
 * @returns {Uint8Array} 明文
 */
function decrypt(ciphertext, key, nonce, counter = 0) {
  return xchacha20Stream(ciphertext, key, nonce, counter);
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    xchacha20Stream,
    encrypt,
    decrypt,
    xchacha20Block,
    hchacha20
  };
}

// ========== 使用示例 ==========
// 生成32字节密钥 (256位)
const key = new Uint8Array(32).fill(1) // 演示用密钥
const nonce = new Uint8Array(24).fill(2) // 演示用Nonce
// 明文消息
const message = new TextEncoder().encode('Hello, XChaCha20!');

// 加密
const ciphertext = encrypt(message, key, nonce);
console.log('密文:',  Buffer.from(ciphertext).toString('hex'));

// 解密
const decrypted = decrypt(ciphertext, key, nonce);
console.log('解密后:', new TextDecoder().decode(decrypted));