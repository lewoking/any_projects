# 摄氏度 华氏度 相互转换函数
def tempcv(inStr):
    # 是C结尾的就认为是摄氏度
    if inStr[-1] in ["C","c"]:  
        f=1.8*float(inStr[0:-1])+32
        return f
    # 是F 结尾的就认为是华氏度
    elif inStr[-1] in ["F","f"]:  
        c=(float(inStr[0:-1])-32)/1.8
        return c
    else :
        return false

if __name__ == '__main__':
	inTemp = input("Please enter a temperature value with a temperature symbol(eg:32c/75F)")
	res = tempcv(inTemp)
	print(res)
