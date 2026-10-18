int second_file_value(void)
{
#if CI_BUILD_FEATURE
    return CI_BUILD_NUMBER;
#else
    return -1;
#endif
}
