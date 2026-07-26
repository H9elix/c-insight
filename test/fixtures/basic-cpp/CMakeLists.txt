cmake_minimum_required(VERSION 3.16)
project(c_insight_fixture LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(calculator src/calculator.cpp)
target_include_directories(calculator PUBLIC include)

add_executable(c_insight_fixture src/main.cpp)
target_link_libraries(c_insight_fixture PRIVATE calculator)
