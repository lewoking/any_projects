# -*- encoding: utf-8 -*-
'''
@File    :   key.py
@Time    :   2021/06/08 10:51:14
@Author  :   guozi
@Version :   1.0
@WebSite    :  github.com/lewoking
'''

# here put the import lib
import pyautogui
 
# 显示一个简单的带文字和OK按钮的消息弹窗。用户点击后返回button的文字。
pyautogui.alert(text='', title='', button='OK')
b = pyautogui.alert(text='要开始程序么？', title='请求框', button='OK')
print(b) # 输出结果为OK
 
# 显示一个简单的带文字、OK和Cancel按钮的消息弹窗，用户点击后返回被点击button的文字，支持自定义数字、文字的列表。
pyautogui.confirm(text='', title='', buttons=['OK', 'Cancel']) # OK和Cancel按钮的消息弹窗
pyautogui.confirm(text='', title='', buttons=range(10)) # 10个按键0-9的消息弹窗
a = pyautogui.confirm(text='', title='', buttons=range(10))
print(a) # 输出结果为你选的数字
 
# 可以输入的消息弹窗，带OK和Cancel按钮。用户点击OK按钮返回输入的文字，点击Cancel按钮返回None。
pyautogui.prompt(text='', title='', default='')
 
# 样式同prompt()，用于输入密码，消息用*表示。带OK和Cancel按钮。用户点击OK按钮返回输入的文字，点击Cancel按钮返回None。
pyautogui.password(text='', title='', default='', mask='*')